import { Types, type HydratedDocument } from "mongoose"
import { HttpError } from "../../middlewares/errorHandler.js"
import { startOfDay } from "../../utils/dates.js"
import { decodeImage } from "../../utils/images.js"
import { NotificationModel } from "../notifications/notification.model.js"
import { pushToUsers } from "../push/push.service.js"
import type { LevelDefinition } from "../settings/settings.schemas.js"
import { getSettings, levelForXp } from "../settings/settings.service.js"
import { UserModel, type UserDocument } from "../users/user.model.js"
import {
  WALL_REACTIONS,
  WallCommentModel,
  WallImageModel,
  WallPostModel,
  WallReactionModel,
  WallReportModel,
  type WallComment,
  type WallPost,
  type WallReaction,
  type WallReportReason,
  type WallStatus,
} from "./wall.model.js"

export type PostDoc = WallPost & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }
export type CommentDoc = WallComment & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }
export type ModerationAction = "hide" | "restore" | "dismiss"

// Anti-spam on comments (posts are capped per day in the settings).
const MAX_COMMENTS_PER_HOUR = 60
// A burst of comments on one post sends a single notification.
const COMMENT_NOTIFY_EVERY_MS = 15 * 60_000

export const wallImageUrl = (id: Types.ObjectId | string) => `/api/wall/images/${id}`

const postNotFound = () => new HttpError(404, "Publication introuvable ou retirée")

// ------------------------------------------------------------ Presenters

interface AuthorSource {
  _id: Types.ObjectId
  firstName: string
  lastName?: string | null
  xp: number
}

export const presentAuthor = (u: AuthorSource, levels: LevelDefinition[]) => {
  const { level, levelName } = levelForXp(u.xp, levels)
  return {
    id: String(u._id),
    name: [u.firstName, u.lastName].filter(Boolean).join(" "),
    initials: `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? u.firstName?.[1] ?? ""}`.toUpperCase(),
    level,
    levelName,
  }
}

export type WallAuthor = ReturnType<typeof presentAuthor>

const UNKNOWN_AUTHOR: WallAuthor = { id: "", name: "Supporter", initials: "?", level: 1, levelName: "" }

/** Lookup of the app-facing author info for a batch of user ids. */
async function authorsOf(ids: Types.ObjectId[]) {
  const [users, { levels }] = await Promise.all([
    UserModel.find({ _id: { $in: ids } }).select("firstName lastName xp").lean<AuthorSource[]>(),
    getSettings(),
  ])
  const byId = new Map(users.map((u) => [String(u._id), presentAuthor(u, levels)]))
  return (id: Types.ObjectId) => byId.get(String(id)) ?? UNKNOWN_AUTHOR
}

const countsOf = (reactions?: Partial<Record<WallReaction, number>> | null) =>
  Object.fromEntries(WALL_REACTIONS.map((r) => [r, Math.max(0, reactions?.[r] ?? 0)])) as Record<WallReaction, number>

export const presentPostBase = (p: PostDoc) => ({
  id: String(p._id),
  text: p.text,
  images: p.images.map((i) => ({ url: wallImageUrl(i.image), width: i.width, height: i.height })),
  reactions: countsOf(p.reactions),
  reactionsCount: Math.max(0, p.reactionsCount),
  commentsCount: Math.max(0, p.commentsCount),
  createdAt: p.createdAt,
})

/** Posts as one supporter sees them (their own reaction, their own posts). */
async function presentPostsFor(viewerId: Types.ObjectId, posts: PostDoc[]) {
  const [author, reactions] = await Promise.all([
    authorsOf(posts.map((p) => p.author)),
    WallReactionModel.find({ user: viewerId, post: { $in: posts.map((p) => p._id) } })
      .select("post type")
      .lean(),
  ])
  const mine = new Map(reactions.map((r) => [String(r.post), r.type]))
  return posts.map((p) => ({
    ...presentPostBase(p),
    author: author(p.author),
    mine: p.author.equals(viewerId),
    myReaction: mine.get(String(p._id)) ?? null,
  }))
}

const presentComment = (c: CommentDoc, author: WallAuthor, viewerId: Types.ObjectId, postAuthor: Types.ObjectId) => ({
  id: String(c._id),
  text: c.text,
  createdAt: c.createdAt,
  author,
  mine: c.author.equals(viewerId),
  // The author of the post can also remove the comments under it.
  canDelete: c.author.equals(viewerId) || postAuthor.equals(viewerId),
})

// ------------------------------------------------------------ Access

async function assertOpen() {
  const { wall } = await getSettings()
  if (!wall.enabled) throw new HttpError(403, "Le mur des fans est fermé pour le moment")
  return wall
}

/** Posting, commenting and reacting: wall open and supporter not blocked from it. */
async function assertCanWrite(user: UserDocument) {
  const wall = await assertOpen()
  if (user.wallBlocked) {
    throw new HttpError(403, "Ton accès au mur des fans est suspendu. Contacte l'équipe depuis le menu › Contact.")
  }
  return wall
}

// ------------------------------------------------------------ Posts

/** recent: newest first. relevant: engagement weighted by freshness. top: most engagement this week. */
export const FEED_SORTS = ["recent", "relevant", "top"] as const
export type FeedSort = (typeof FEED_SORTS)[number]
export const FEED_FILTERS = ["all", "photos", "mine"] as const
export type FeedFilter = (typeof FEED_FILTERS)[number]

// Ranked feeds only look this far back: an old post never climbs back to the top.
const RANKED_WINDOW_DAYS: Record<Exclude<FeedSort, "recent">, number> = { relevant: 30, top: 7 }

export interface FeedQuery {
  sort: FeedSort
  filter: FeedFilter
  /** recent: id of the last post sent. Ranked feeds: number of posts already sent. */
  cursor?: string
  limit: number
}

export async function listFeed(viewerId: Types.ObjectId, { sort, filter, cursor, limit }: FeedQuery) {
  const match: Record<string, unknown> = { status: "published" }
  if (filter === "photos") match["images.0"] = { $exists: true }
  if (filter === "mine") match.author = viewerId

  if (sort === "recent") {
    if (cursor) match._id = { $lt: new Types.ObjectId(cursor) }
    const posts = await WallPostModel.find(match)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean<PostDoc[]>()
    const page = posts.slice(0, limit)
    return {
      items: await presentPostsFor(viewerId, page),
      nextCursor: posts.length > limit ? String(page[page.length - 1]._id) : null,
    }
  }

  // Scores move between two pages, so ranked feeds page by position (the app drops repeats).
  const offset = Number(cursor) || 0
  const now = new Date()
  match.createdAt = { $gte: new Date(now.getTime() - RANKED_WINDOW_DAYS[sort] * 86_400_000) }
  // A comment takes more effort than a reaction: it counts double.
  const engagement = { $add: ["$reactionsCount", { $multiply: ["$commentsCount", 2] }] }
  const ageHours = { $divide: [{ $subtract: [now, "$createdAt"] }, 3_600_000] }
  // Hacker News style, gentler decay (1.2): a fresh post with a few reactions beats an
  // old popular one, but a post nobody reacted to scores 0 and only follows, newest first.
  const score =
    sort === "top"
      ? engagement
      : { $divide: [engagement, { $pow: [{ $add: [ageHours, 2] }, 1.2] }] }
  const posts = await WallPostModel.aggregate<PostDoc>([
    { $match: match },
    { $addFields: { score } },
    { $sort: { score: -1, _id: -1 } },
    { $skip: offset },
    { $limit: limit + 1 },
    { $project: { score: 0 } },
  ])
  const page = posts.slice(0, limit)
  return {
    items: await presentPostsFor(viewerId, page),
    nextCursor: posts.length > limit ? String(offset + limit) : null,
  }
}

export async function getPost(viewerId: Types.ObjectId, postId: string) {
  await assertOpen()
  const post = await WallPostModel.findOne({ _id: postId, status: "published" }).lean<PostDoc>()
  if (!post) throw postNotFound()
  const [presented] = await presentPostsFor(viewerId, [post])
  return presented
}

export interface NewPostInput {
  text: string
  images: Array<{ data: string; width: number; height: number }>
}

export async function createPost(user: UserDocument, input: NewPostInput) {
  const wall = await assertCanWrite(user)
  if (!input.text && !input.images.length) throw new HttpError(400, "Écris un message ou ajoute une photo")

  const today = await WallPostModel.countDocuments({ author: user._id, createdAt: { $gte: startOfDay() } })
  if (today >= wall.maxPostsPerDay) {
    throw new HttpError(429, `Tu as atteint la limite de ${wall.maxPostsPerDay} publications par jour, reviens demain !`)
  }

  const photos = input.images.map((img) => ({ ...decodeImage(img.data), width: img.width, height: img.height }))
  const postId = new Types.ObjectId()
  const images = photos.length
    ? await WallImageModel.insertMany(
        photos.map(({ data, contentType }) => ({ data, contentType, size: data.length, owner: user._id, post: postId })),
      )
    : []

  try {
    const post = await WallPostModel.create({
      _id: postId,
      author: user._id,
      text: input.text,
      images: images.map((doc, i) => ({ image: doc._id, width: photos[i].width, height: photos[i].height })),
    })
    const [presented] = await presentPostsFor(user._id, [post.toObject() as PostDoc])
    return presented
  } catch (err) {
    await WallImageModel.deleteMany({ post: postId })
    throw err
  }
}

/** Removes a post with everything attached to it (photos, comments, reactions, reports). */
async function deletePostCascade(postId: Types.ObjectId) {
  await Promise.all([
    WallImageModel.deleteMany({ post: postId }),
    WallCommentModel.deleteMany({ post: postId }),
    WallReactionModel.deleteMany({ post: postId }),
    WallReportModel.deleteMany({ post: postId }),
    NotificationModel.deleteMany({ category: "wall", ref: String(postId) }),
    WallPostModel.deleteOne({ _id: postId }),
  ])
}

export async function deleteMyPost(userId: Types.ObjectId, postId: string) {
  const post = await WallPostModel.findOne({ _id: postId, author: userId }).select("_id").lean()
  if (!post) throw new HttpError(404, "Publication introuvable")
  await deletePostCascade(post._id)
}

export async function deletePost(postId: string) {
  const post = await WallPostModel.findById(postId).select("_id").lean()
  if (!post) throw new HttpError(404, "Publication introuvable")
  await deletePostCascade(post._id)
}

// ------------------------------------------------------------ Reactions

/** Sets (or with null removes) the supporter's reaction; counters move with it. */
export async function setReaction(user: UserDocument, postId: string, type: WallReaction | null) {
  await assertCanWrite(user)
  const post = await WallPostModel.findOne({ _id: postId, status: "published" }).select("_id").lean()
  if (!post) throw postNotFound()

  if (type) {
    const previous = await WallReactionModel.findOneAndUpdate(
      { post: post._id, user: user._id },
      { type },
      { upsert: true, returnDocument: "before" },
    ).lean()
    if (!previous) {
      await WallPostModel.updateOne({ _id: post._id }, { $inc: { [`reactions.${type}`]: 1, reactionsCount: 1 } })
    } else if (previous.type !== type) {
      await WallPostModel.updateOne({ _id: post._id }, { $inc: { [`reactions.${previous.type}`]: -1, [`reactions.${type}`]: 1 } })
    }
  } else {
    const removed = await WallReactionModel.findOneAndDelete({ post: post._id, user: user._id }).lean()
    if (removed) {
      await WallPostModel.updateOne({ _id: post._id }, { $inc: { [`reactions.${removed.type}`]: -1, reactionsCount: -1 } })
    }
  }

  const updated = await WallPostModel.findById(post._id).select("reactions reactionsCount").lean()
  return {
    reactions: countsOf(updated?.reactions),
    reactionsCount: Math.max(0, updated?.reactionsCount ?? 0),
    myReaction: type,
  }
}

// ------------------------------------------------------------ Comments

export async function listComments(
  viewerId: Types.ObjectId,
  postId: string,
  { after, limit }: { after?: string; limit: number },
) {
  await assertOpen()
  const post = await WallPostModel.findOne({ _id: postId, status: "published" }).select("author").lean()
  if (!post) throw postNotFound()

  const filter = {
    post: post._id,
    status: "published" as const,
    ...(after ? { _id: { $gt: new Types.ObjectId(after) } } : {}),
  }
  const comments = await WallCommentModel.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean<CommentDoc[]>()
  const page = comments.slice(0, limit)
  const author = await authorsOf(page.map((c) => c.author))
  return {
    items: page.map((c) => presentComment(c, author(c.author), viewerId, post.author)),
    nextCursor: comments.length > limit ? String(page[page.length - 1]._id) : null,
  }
}

async function notifyNewComment(to: Types.ObjectId, postId: Types.ObjectId, commenter: string, text: string) {
  const ref = String(postId)
  const recent = await NotificationModel.exists({
    user: to,
    category: "wall",
    ref,
    createdAt: { $gte: new Date(Date.now() - COMMENT_NOTIFY_EVERY_MS) },
  })
  if (recent) return

  const title = `${commenter} a commenté ta publication`
  const body = text.length > 140 ? `${text.slice(0, 140)}…` : text
  await NotificationModel.create({ user: to, category: "wall", title, message: body, ref })
  await pushToUsers({ userIds: [to], preference: "wall" }, () => ({
    channel: "wall",
    title,
    body,
    data: { type: "wall", postId: ref },
  }))
}

export async function addComment(user: UserDocument, postId: string, text: string) {
  await assertCanWrite(user)
  const lastHour = await WallCommentModel.countDocuments({
    author: user._id,
    createdAt: { $gte: new Date(Date.now() - 3_600_000) },
  })
  if (lastHour >= MAX_COMMENTS_PER_HOUR) {
    throw new HttpError(429, "Tu commentes beaucoup ! Fais une petite pause et réessaie plus tard.")
  }

  const post = await WallPostModel.findOneAndUpdate(
    { _id: postId, status: "published" },
    { $inc: { commentsCount: 1 } },
    { returnDocument: "after" },
  )
    .select("author commentsCount")
    .lean()
  if (!post) throw postNotFound()

  const comment = await WallCommentModel.create({ post: post._id, author: user._id, text })
  if (!post.author.equals(user._id)) {
    notifyNewComment(post.author, post._id, user.firstName, text).catch((err) =>
      console.error("[wall] notification impossible :", (err as Error).message),
    )
  }

  const { levels } = await getSettings()
  return {
    comment: presentComment(comment.toObject() as CommentDoc, presentAuthor(user, levels), user._id, post.author),
    commentsCount: post.commentsCount,
  }
}

/** Pending comment reports, summed on the post (drives the dashboard's "Signalées" tab). */
async function syncCommentReports(postId: Types.ObjectId) {
  const [row] = await WallCommentModel.aggregate<{ n: number }>([
    { $match: { post: postId, pendingReports: { $gt: 0 } } },
    { $group: { _id: null, n: { $sum: "$pendingReports" } } },
  ])
  await WallPostModel.updateOne({ _id: postId }, { pendingCommentReports: row?.n ?? 0 })
}

async function removeComment(comment: Pick<CommentDoc, "_id" | "post" | "status">) {
  await Promise.all([
    WallCommentModel.deleteOne({ _id: comment._id }),
    WallReportModel.deleteMany({ target: comment._id }),
  ])
  if (comment.status === "published") {
    await WallPostModel.updateOne({ _id: comment.post }, { $inc: { commentsCount: -1 } })
  }
  await syncCommentReports(comment.post)
}

/** The comment's author, or the author of the post it's under. */
export async function deleteMyComment(userId: Types.ObjectId, commentId: string) {
  const comment = await WallCommentModel.findById(commentId).lean<CommentDoc>()
  if (!comment) throw new HttpError(404, "Commentaire introuvable")
  const post = await WallPostModel.findById(comment.post).select("author").lean()
  if (!comment.author.equals(userId) && !post?.author.equals(userId)) {
    throw new HttpError(403, "Tu ne peux supprimer que tes commentaires ou ceux de tes publications")
  }
  await removeComment(comment)
}

export async function deleteComment(commentId: string) {
  const comment = await WallCommentModel.findById(commentId).lean<CommentDoc>()
  if (!comment) throw new HttpError(404, "Commentaire introuvable")
  await removeComment(comment)
}

/** Status change that keeps the post's comment counter right. */
async function setCommentStatus(
  comment: HydratedDocument<WallComment>,
  status: WallStatus,
  hiddenBy?: "admin" | "reports",
) {
  const wasPublished = comment.status === "published"
  comment.status = status
  comment.hiddenBy = status === "hidden" ? hiddenBy : undefined
  await comment.save()
  const delta = Number(status === "published") - Number(wasPublished)
  if (delta) await WallPostModel.updateOne({ _id: comment.post }, { $inc: { commentsCount: delta } })
}

// ------------------------------------------------------------ Reports & moderation

/** One report per supporter and content; enough of them hide it until the team reviews it. */
export async function reportContent(
  user: UserDocument,
  targetType: "post" | "comment",
  targetId: string,
  reason: WallReportReason,
) {
  const wall = await assertOpen()

  const target =
    targetType === "post"
      ? await WallPostModel.findOne({ _id: targetId, status: "published" }).select("author").lean()
      : await WallCommentModel.findOne({ _id: targetId, status: "published" }).select("author post").lean()
  if (!target) {
    throw new HttpError(404, targetType === "post" ? "Publication introuvable ou retirée" : "Commentaire introuvable ou retiré")
  }
  if (target.author.equals(user._id)) throw new HttpError(400, "Tu ne peux pas signaler ton propre contenu")
  const postId = "post" in target ? target.post : target._id

  try {
    await WallReportModel.create({ targetType, target: target._id, post: postId, reporter: user._id, reason })
  } catch (err) {
    // Already reported by this supporter: nothing more to do.
    if ((err as { code?: number }).code === 11000) return
    throw err
  }

  const autoHide = (pending: number) => wall.autoHideReports > 0 && pending >= wall.autoHideReports

  if (targetType === "post") {
    const post = await WallPostModel.findByIdAndUpdate(target._id, { $inc: { pendingReports: 1 } }, { returnDocument: "after" })
    if (post && post.status === "published" && autoHide(post.pendingReports)) {
      post.status = "hidden"
      post.hiddenBy = "reports"
      post.hiddenAt = new Date()
      await post.save()
    }
  } else {
    const comment = await WallCommentModel.findByIdAndUpdate(target._id, { $inc: { pendingReports: 1 } }, { returnDocument: "after" })
    if (comment && comment.status === "published" && autoHide(comment.pendingReports)) {
      await setCommentStatus(comment, "hidden", "reports")
    }
    await syncCommentReports(postId)
  }
}

/** hide / restore / dismiss (reports unfounded): every pending report counts as reviewed. */
export async function moderatePost(postId: string, action: ModerationAction) {
  const post = await WallPostModel.findById(postId)
  if (!post) throw new HttpError(404, "Publication introuvable")
  const notifyAuthor = action === "hide" && post.hiddenBy !== "admin"

  if (action === "hide") {
    post.status = "hidden"
    post.hiddenBy = "admin"
    post.hiddenAt = new Date()
  } else if (action === "restore") {
    post.status = "published"
    post.hiddenBy = undefined
    post.hiddenAt = undefined
  }
  post.pendingReports = 0
  await post.save()
  await WallReportModel.updateMany({ target: post._id, status: "pending" }, { status: "reviewed" })

  if (notifyAuthor) {
    await NotificationModel.create({
      user: post.author,
      category: "system",
      title: "Publication retirée du mur",
      message:
        "Une de tes publications sur le mur des fans a été retirée par l'équipe Tunfcb : elle ne respecte pas les règles de la communauté.",
    })
  }
}

export async function moderateComment(commentId: string, action: ModerationAction) {
  const comment = await WallCommentModel.findById(commentId)
  if (!comment) throw new HttpError(404, "Commentaire introuvable")

  comment.pendingReports = 0
  if (action === "hide") await setCommentStatus(comment, "hidden", "admin")
  else if (action === "restore") await setCommentStatus(comment, "published")
  else await comment.save()

  await WallReportModel.updateMany({ target: comment._id, status: "pending" }, { status: "reviewed" })
  await syncCommentReports(comment.post)
}

export async function setWallBlocked(userId: string, blocked: boolean) {
  const user = await UserModel.findById(userId).select("wallBlocked")
  if (!user) throw new HttpError(404, "Utilisateur introuvable")
  if (Boolean(user.wallBlocked) === blocked) return
  user.wallBlocked = blocked
  await user.save()
  await NotificationModel.create({
    user: user._id,
    category: "system",
    title: blocked ? "Accès au mur des fans suspendu" : "Accès au mur des fans rétabli",
    message: blocked
      ? "Tu peux toujours lire le mur des fans mais plus y publier, commenter ni réagir. Pour en savoir plus, écris à l'équipe depuis le menu › Contact."
      : "Tu peux de nouveau publier, commenter et réagir sur le mur des fans. Merci de respecter les autres supporters !",
  })
}

/** Account deletion: their posts go, and their comments, reactions and reports stop counting elsewhere. */
export async function deleteWallDataOfUser(userId: Types.ObjectId) {
  const posts = await WallPostModel.find({ author: userId }).distinct("_id")
  for (const id of posts) await deletePostCascade(id)

  const comments = await WallCommentModel.find({ author: userId }).select("post status").lean<CommentDoc[]>()
  for (const comment of comments) await removeComment(comment)

  const reactions = await WallReactionModel.find({ user: userId }).select("post type").lean()
  await Promise.all(
    reactions.map((r) =>
      WallPostModel.updateOne({ _id: r.post }, { $inc: { [`reactions.${r.type}`]: -1, reactionsCount: -1 } }),
    ),
  )

  const reports = await WallReportModel.find({ reporter: userId, status: "pending" }).select("targetType target post").lean()
  for (const r of reports) {
    const filter = { _id: r.target, pendingReports: { $gt: 0 } }
    if (r.targetType === "post") await WallPostModel.updateOne(filter, { $inc: { pendingReports: -1 } })
    else await WallCommentModel.updateOne(filter, { $inc: { pendingReports: -1 } })
  }
  const commentPosts = new Set(reports.filter((r) => r.targetType === "comment").map((r) => String(r.post)))
  for (const id of commentPosts) await syncCommentReports(new Types.ObjectId(id))

  await Promise.all([
    WallReactionModel.deleteMany({ user: userId }),
    WallReportModel.deleteMany({ reporter: userId }),
    WallImageModel.deleteMany({ owner: userId }),
  ])
}

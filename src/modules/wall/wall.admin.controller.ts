import type { RequestHandler } from "express"
import type { Types } from "mongoose"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { startOfDay } from "../../utils/dates.js"
import { escapeRegex, paginated, paginationSchema } from "../../utils/pagination.js"
import { settingsSchema } from "../settings/settings.schemas.js"
import { getSettings, updateSettings } from "../settings/settings.service.js"
import { UserModel } from "../users/user.model.js"
import { WallCommentModel, WallPostModel, WallReportModel } from "./wall.model.js"
import {
  deleteComment,
  deletePost,
  moderateComment,
  moderatePost,
  presentPostBase,
  setWallBlocked,
  type CommentDoc,
  type PostDoc,
} from "./wall.service.js"

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Identifiant invalide")
const idParam = (params: Record<string, unknown>) => objectId.parse(params.id)

// Posts with reports nobody has reviewed yet (on the post or one of its comments).
const REPORTED = { $or: [{ pendingReports: { $gt: 0 } }, { pendingCommentReports: { $gt: 0 } }] }

interface AdminAuthorSource {
  _id: Types.ObjectId
  firstName: string
  lastName?: string | null
  email?: string
  phone?: string
  username: string
  status: string
  wallBlocked?: boolean | null
}

async function adminAuthorsOf(ids: Types.ObjectId[]) {
  const users = await UserModel.find({ _id: { $in: ids } })
    .select("firstName lastName email phone username status wallBlocked")
    .lean<AdminAuthorSource[]>()
  const byId = new Map(
    users.map((u) => [
      String(u._id),
      {
        id: String(u._id),
        name: [u.firstName, u.lastName].filter(Boolean).join(" "),
        email: u.email ?? null,
        phone: u.phone ?? null,
        username: u.username,
        banned: u.status === "banned",
        wallBlocked: Boolean(u.wallBlocked),
      },
    ]),
  )
  return (id: Types.ObjectId) => byId.get(String(id)) ?? null
}

const presentAdminPost = (p: PostDoc) => ({
  ...presentPostBase(p),
  status: p.status,
  hiddenBy: p.hiddenBy ?? null,
  hiddenAt: p.hiddenAt ?? null,
  pendingReports: p.pendingReports,
  pendingCommentReports: p.pendingCommentReports,
})

/** Sidebar badge and page header. */
export const wallSummary: RequestHandler = async (_req, res) => {
  const [reported, hidden, postsToday, { wall }] = await Promise.all([
    WallPostModel.countDocuments(REPORTED),
    WallPostModel.countDocuments({ status: "hidden" }),
    WallPostModel.countDocuments({ createdAt: { $gte: startOfDay() } }),
    getSettings(),
  ])
  res.json({ wall, reported, hidden, postsToday })
}

export const updateWallSettings: RequestHandler = async (req, res) => {
  const wall = settingsSchema.shape.wall.parse(req.body)
  const settings = await getSettings()
  const saved = await updateSettings({ ...settings, wall })
  res.json({ wall: saved.wall })
}

export const listPosts: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const { view, search } = z
    .object({ view: z.enum(["reported", "hidden", "all"]).default("all"), search: z.string().trim().optional() })
    .parse(req.query)

  const conditions: object[] = []
  if (view === "reported") conditions.push(REPORTED)
  if (view === "hidden") conditions.push({ status: "hidden" })
  if (search) {
    // Every word must match the author (so "Mohamed Mejri" finds first + last name), or the text matches.
    const words = search.split(/\s+/).filter(Boolean).map((w) => ({ $regex: escapeRegex(w), $options: "i" }))
    const authorIds = await UserModel.find({
      $and: words.map((w) => ({ $or: [{ firstName: w }, { lastName: w }, { email: w }, { phone: w }, { username: w }] })),
    }).distinct("_id")
    conditions.push({ $or: [{ text: { $regex: escapeRegex(search), $options: "i" } }, { author: { $in: authorIds } }] })
  }
  const filter = conditions.length ? { $and: conditions } : {}

  const [posts, total, reported, hidden, all] = await Promise.all([
    WallPostModel.find(filter)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<PostDoc[]>(),
    WallPostModel.countDocuments(filter),
    WallPostModel.countDocuments(REPORTED),
    WallPostModel.countDocuments({ status: "hidden" }),
    WallPostModel.estimatedDocumentCount(),
  ])
  const author = await adminAuthorsOf(posts.map((p) => p.author))

  res.json({
    ...paginated(
      posts.map((p) => ({ ...presentAdminPost(p), author: author(p.author) })),
      total,
      page,
      limit,
    ),
    counts: { reported, hidden, all },
  })
}

/** A post with all its comments (hidden ones included) and the reports about them. */
export const getPost: RequestHandler = async (req, res) => {
  const post = await WallPostModel.findById(idParam(req.params)).lean<PostDoc>()
  if (!post) throw new HttpError(404, "Publication introuvable")

  const [comments, reports] = await Promise.all([
    WallCommentModel.find({ post: post._id }).sort({ _id: 1 }).limit(500).lean<CommentDoc[]>(),
    WallReportModel.find({ post: post._id }).sort({ createdAt: -1 }).limit(200).lean(),
  ])
  const user = await adminAuthorsOf([post.author, ...comments.map((c) => c.author), ...reports.map((r) => r.reporter)])

  res.json({
    post: { ...presentAdminPost(post), author: user(post.author) },
    comments: comments.map((c) => ({
      id: String(c._id),
      text: c.text,
      createdAt: c.createdAt,
      status: c.status,
      hiddenBy: c.hiddenBy ?? null,
      pendingReports: c.pendingReports,
      author: user(c.author),
    })),
    reports: reports.map((r) => ({
      id: String(r._id),
      targetType: r.targetType,
      target: String(r.target),
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      reporter: user(r.reporter)?.name ?? "Compte supprimé",
    })),
  })
}

const moderationSchema = z.object({ action: z.enum(["hide", "restore", "dismiss"]) })

export const moderatePostHandler: RequestHandler = async (req, res) => {
  await moderatePost(idParam(req.params), moderationSchema.parse(req.body).action)
  res.json({ ok: true })
}

export const deletePostHandler: RequestHandler = async (req, res) => {
  await deletePost(idParam(req.params))
  res.json({ ok: true })
}

export const moderateCommentHandler: RequestHandler = async (req, res) => {
  await moderateComment(idParam(req.params), moderationSchema.parse(req.body).action)
  res.json({ ok: true })
}

export const deleteCommentHandler: RequestHandler = async (req, res) => {
  await deleteComment(idParam(req.params))
  res.json({ ok: true })
}

export const blockUser: RequestHandler = async (req, res) => {
  const { blocked } = z.object({ blocked: z.boolean() }).parse(req.body)
  await setWallBlocked(idParam(req.params), blocked)
  res.json({ ok: true })
}

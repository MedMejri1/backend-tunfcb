import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { MAX_IMAGE_BASE64 } from "../../utils/images.js"
import { getSettings } from "../settings/settings.service.js"
import type { UserDocument } from "../users/user.model.js"
import {
  WALL_MAX_COMMENT,
  WALL_MAX_IMAGES,
  WALL_MAX_TEXT,
  WALL_REACTIONS,
  WALL_REPORT_REASONS,
  WallImageModel,
} from "./wall.model.js"
import {
  FEED_FILTERS,
  FEED_SORTS,
  addComment,
  createPost,
  deleteMyComment,
  deleteMyPost,
  getPost,
  listComments,
  listFeed,
  reportContent,
  setReaction,
} from "./wall.service.js"

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Identifiant invalide")
const idParam = (params: Record<string, unknown>) => objectId.parse(params.id)

const pageSchema = z.object({
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
})

/** The wall's state for this supporter (closed, blocked). */
async function wallStatus(user: UserDocument) {
  const { wall } = await getSettings()
  return { enabled: wall.enabled, blocked: Boolean(user.wallBlocked), maxPostsPerDay: wall.maxPostsPerDay }
}

// Older app versions send neither sort nor filter: newest first, every post.
const feedSchema = z
  .object({
    sort: z.enum(FEED_SORTS).default("recent"),
    filter: z.enum(FEED_FILTERS).default("all"),
    cursor: z.string().max(24).optional(),
    limit: z.coerce.number().int().min(1).max(30).default(10),
  })
  .refine(
    (q) => !q.cursor || (q.sort === "recent" ? objectId.safeParse(q.cursor).success : /^\d{1,5}$/.test(q.cursor)),
    { message: "Curseur invalide", path: ["cursor"] },
  )

/** Feed: newest first, most relevant or top of the week, optionally photos only or own posts. */
export const feed: RequestHandler = async (req, res) => {
  const user = req.appUser!
  const status = await wallStatus(user)
  if (!status.enabled) {
    res.json({ wall: status, items: [], nextCursor: null })
    return
  }
  res.json({ wall: status, ...(await listFeed(user._id, feedSchema.parse(req.query))) })
}

const createSchema = z.object({
  text: z.string().trim().max(WALL_MAX_TEXT, `${WALL_MAX_TEXT} caractères maximum`).default(""),
  images: z
    .array(
      z.object({
        data: z.string().min(100).max(MAX_IMAGE_BASE64, "Photo trop lourde (1,5 Mo maximum)"),
        width: z.number().int().min(1).max(10_000),
        height: z.number().int().min(1).max(10_000),
      }),
    )
    .max(WALL_MAX_IMAGES, `${WALL_MAX_IMAGES} photos maximum`)
    .default([]),
})

export const publish: RequestHandler = async (req, res) => {
  const post = await createPost(req.appUser!, createSchema.parse(req.body))
  res.status(201).json({ post })
}

export const post: RequestHandler = async (req, res) => {
  const user = req.appUser!
  res.json({ post: await getPost(user._id, idParam(req.params)), wall: await wallStatus(user) })
}

export const removePost: RequestHandler = async (req, res) => {
  await deleteMyPost(req.appUser!._id, idParam(req.params))
  res.json({ ok: true })
}

export const react: RequestHandler = async (req, res) => {
  const { type } = z.object({ type: z.enum(WALL_REACTIONS) }).parse(req.body)
  res.json(await setReaction(req.appUser!, idParam(req.params), type))
}

export const unreact: RequestHandler = async (req, res) => {
  res.json(await setReaction(req.appUser!, idParam(req.params), null))
}

export const comments: RequestHandler = async (req, res) => {
  const { cursor, limit } = pageSchema.extend({ limit: z.coerce.number().int().min(1).max(50).default(30) }).parse(req.query)
  res.json(await listComments(req.appUser!._id, idParam(req.params), { after: cursor, limit }))
}

const commentSchema = z.object({
  text: z.string().trim().min(1, "Écris ton commentaire").max(WALL_MAX_COMMENT, `${WALL_MAX_COMMENT} caractères maximum`),
})

export const comment: RequestHandler = async (req, res) => {
  const { text } = commentSchema.parse(req.body)
  res.status(201).json(await addComment(req.appUser!, idParam(req.params), text))
}

export const removeComment: RequestHandler = async (req, res) => {
  await deleteMyComment(req.appUser!._id, idParam(req.params))
  res.json({ ok: true })
}

const reportSchema = z.object({ reason: z.enum(WALL_REPORT_REASONS) })

export const reportPost: RequestHandler = async (req, res) => {
  await reportContent(req.appUser!, "post", idParam(req.params), reportSchema.parse(req.body).reason)
  res.json({ ok: true })
}

export const reportComment: RequestHandler = async (req, res) => {
  await reportContent(req.appUser!, "comment", idParam(req.params), reportSchema.parse(req.body).reason)
  res.json({ ok: true })
}

/** Public: <Image> in the app and <img> in the dashboard can't send a token. */
export const image: RequestHandler = async (req, res) => {
  const photo = await WallImageModel.findById(idParam(req.params)).select("data contentType")
  if (!photo) throw new HttpError(404, "Photo introuvable")
  res.set({
    "Content-Type": photo.contentType,
    // A photo never changes: a new one gets a new id.
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "cross-origin",
  })
  res.send(photo.data)
}

import { Schema, model, Types, type InferSchemaType } from "mongoose"

/** Emoji reactions: the app shows each key as its emoji. */
export const WALL_REACTIONS = ["love", "haha", "fire", "clap", "wow", "sad"] as const
export type WallReaction = (typeof WALL_REACTIONS)[number]

export const WALL_REPORT_REASONS = ["spam", "harassment", "inappropriate", "other"] as const
export type WallReportReason = (typeof WALL_REPORT_REASONS)[number]

// hidden = taken off the wall, by the team or automatically after too many reports.
export const WALL_STATUSES = ["published", "hidden"] as const
export type WallStatus = (typeof WALL_STATUSES)[number]

export const WALL_MAX_IMAGES = 3
export const WALL_MAX_TEXT = 1000
export const WALL_MAX_COMMENT = 500

const reactionCountsSchema = new Schema(
  {
    love: { type: Number, default: 0 },
    haha: { type: Number, default: 0 },
    fire: { type: Number, default: 0 },
    clap: { type: Number, default: 0 },
    wow: { type: Number, default: 0 },
    sad: { type: Number, default: 0 },
  },
  { _id: false },
)

const postImageSchema = new Schema(
  {
    image: { type: Types.ObjectId, ref: "WallImage", required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false },
)

const postSchema = new Schema(
  {
    author: { type: Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, default: "", trim: true, maxlength: WALL_MAX_TEXT },
    images: { type: [postImageSchema], default: [] },
    reactions: { type: reactionCountsSchema, default: () => ({}) },
    reactionsCount: { type: Number, default: 0 },
    // Published comments only.
    commentsCount: { type: Number, default: 0 },
    status: { type: String, enum: WALL_STATUSES, default: "published" },
    hiddenBy: { type: String, enum: ["admin", "reports"] },
    hiddenAt: { type: Date },
    // Reports the team hasn't reviewed yet, on the post and on its comments.
    pendingReports: { type: Number, default: 0 },
    pendingCommentReports: { type: Number, default: 0 },
  },
  { timestamps: true },
)

postSchema.index({ status: 1, _id: -1 })

const commentSchema = new Schema(
  {
    post: { type: Types.ObjectId, ref: "WallPost", required: true },
    author: { type: Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: WALL_MAX_COMMENT },
    status: { type: String, enum: WALL_STATUSES, default: "published" },
    hiddenBy: { type: String, enum: ["admin", "reports"] },
    pendingReports: { type: Number, default: 0 },
  },
  { timestamps: true },
)

commentSchema.index({ post: 1, _id: 1 })

// One reaction per supporter and post (changing it replaces the previous one).
const reactionSchema = new Schema(
  {
    post: { type: Types.ObjectId, ref: "WallPost", required: true },
    user: { type: Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: WALL_REACTIONS, required: true },
  },
  { timestamps: true },
)

reactionSchema.index({ post: 1, user: 1 }, { unique: true })

const reportSchema = new Schema(
  {
    targetType: { type: String, enum: ["post", "comment"], required: true },
    target: { type: Types.ObjectId, required: true },
    // The reported post, or the post of the reported comment.
    post: { type: Types.ObjectId, ref: "WallPost", required: true, index: true },
    reporter: { type: Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, enum: WALL_REPORT_REASONS, required: true },
    status: { type: String, enum: ["pending", "reviewed"], default: "pending" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

reportSchema.index({ target: 1, reporter: 1 }, { unique: true })

// Photos are stored in MongoDB, not on disk: Render's disk is wiped at each deploy.
const imageSchema = new Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    owner: { type: Types.ObjectId, ref: "User", required: true, index: true },
    post: { type: Types.ObjectId, ref: "WallPost", required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export type WallPost = InferSchemaType<typeof postSchema>
export type WallComment = InferSchemaType<typeof commentSchema>
export const WallPostModel = model("WallPost", postSchema)
export const WallCommentModel = model("WallComment", commentSchema)
export const WallReactionModel = model("WallReaction", reactionSchema)
export const WallReportModel = model("WallReport", reportSchema)
export const WallImageModel = model("WallImage", imageSchema)

import { Schema, model, type InferSchemaType, Types } from "mongoose"

export const NOTIFICATION_CATEGORIES = ["match", "reward", "quiz", "news", "system", "referral", "order", "support"] as const

const notificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, default: "system" },
    // Absent = broadcast to every user
    user: { type: Types.ObjectId, ref: "User", index: true },
    createdBy: { type: Types.ObjectId, ref: "Admin" },
    // Id of the related object (the order for "order" notifications).
    ref: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

notificationSchema.index({ createdAt: -1 })

export type Notification = InferSchemaType<typeof notificationSchema>
export const NotificationModel = model("Notification", notificationSchema)

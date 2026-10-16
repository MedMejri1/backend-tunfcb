import { Schema, model, Types, type InferSchemaType } from "mongoose"

export const SUPPORT_CATEGORIES = ["question", "compte", "jeux", "boutique", "bug", "suggestion", "autre"] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

// open = waiting for the team, answered = waiting for the supporter.
export const SUPPORT_STATUSES = ["open", "answered", "closed"] as const
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

const messageSchema = new Schema(
  {
    from: { type: String, enum: ["user", "admin"], required: true },
    body: { type: String, required: true, maxlength: 2000 },
    at: { type: Date, required: true },
    admin: { type: Types.ObjectId, ref: "Admin" },
  },
  { _id: false },
)

const ticketSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    user: { type: Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    order: { type: Types.ObjectId, ref: "Order" },
    status: { type: String, enum: SUPPORT_STATUSES, default: "open", index: true },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, required: true },
    // Unread flags for each side.
    adminUnread: { type: Boolean, default: true },
    userUnread: { type: Boolean, default: false },
  },
  { timestamps: true },
)

ticketSchema.index({ lastMessageAt: -1 })

export type SupportTicket = InferSchemaType<typeof ticketSchema>
export const SupportTicketModel = model("SupportTicket", ticketSchema)

import { Schema, model, type InferSchemaType, Types } from "mongoose"

export const TRANSACTION_TYPES = [
  "quiz",
  "wheel",
  "prediction",
  "ad",
  "streak",
  "mission",
  "referral",
  "admin",
  "spent",
] as const

export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/**
 * Points ledger: every balance change is recorded here. Leaderboards for a
 * period are the sum of a user's transactions in that period ("spent" excluded).
 */
const transactionSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    title: { type: String, required: true },
    detail: { type: String },
    // Id of the game entity that produced it (quiz attempt, prediction…)
    ref: { type: String },
    createdBy: { type: Types.ObjectId, ref: "Admin" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

transactionSchema.index({ user: 1, createdAt: -1 })
transactionSchema.index({ createdAt: -1, type: 1 })

export type Transaction = InferSchemaType<typeof transactionSchema>
export const TransactionModel = model("Transaction", transactionSchema)

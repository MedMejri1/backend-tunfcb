import { Schema, model } from "mongoose"

/**
 * One row per Barça match, stamped when its reminder and full-time pushes go
 * out: several server instances (local + Render) can run the scheduler
 * without sending twice.
 */
const matchAlertSchema = new Schema(
  {
    espnEventId: { type: String, required: true, unique: true },
    reminderSentAt: { type: Date },
    endSentAt: { type: Date },
  },
  { timestamps: true },
)

export const MatchAlertModel = model("MatchAlert", matchAlertSchema)

/** One row per daily reminder ("morning:2026-10-17"), with how many devices accepted it. */
const pushLogSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    sent: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const PushLogModel = model("PushLog", pushLogSchema)

/** Phones used without an account: they only receive the match pushes. */
const guestDeviceSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    matches: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

export const GuestDeviceModel = model("GuestDevice", guestDeviceSchema)

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000

/** True for the first caller only: marks this match's `field` push as sent. */
export async function claimMatchAlert(espnEventId: string, field: "reminderSentAt" | "endSentAt"): Promise<boolean> {
  try {
    const res = await MatchAlertModel.updateOne(
      { espnEventId, [field]: { $exists: false } },
      { $set: { [field]: new Date() } },
      { upsert: true },
    )
    return res.modifiedCount + res.upsertedCount > 0
  } catch (err) {
    // The row exists with `field` already set: the upsert collides on espnEventId.
    if (isDuplicate(err)) return false
    throw err
  }
}

/** True for the first caller only: reserves a daily reminder. */
export async function claimDailyPush(key: string): Promise<boolean> {
  try {
    await PushLogModel.create({ key })
    return true
  } catch (err) {
    if (isDuplicate(err)) return false
    throw err
  }
}

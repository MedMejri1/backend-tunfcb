import { Schema, model, type InferSchemaType, Types } from "mongoose"

export const MISSION_EVENTS = [
  "news_read",
  "quiz_completed",
  "quiz_perfect",
  "ad_watched",
  "prediction_made",
  "wheel_spun",
  "streak_claimed",
  "referral_completed",
] as const

export type MissionEvent = (typeof MISSION_EVENTS)[number]

const missionSchema = new Schema(
  {
    scope: { type: String, enum: ["daily", "weekly"], required: true },
    event: { type: String, enum: MISSION_EVENTS, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    icon: { type: String, default: "flag" },
    color: { type: String, default: "#FFCB05" },
    target: { type: Number, required: true, min: 1 },
    reward: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
)

missionSchema.index({ active: 1, event: 1 })

export type Mission = InferSchemaType<typeof missionSchema>
export const MissionModel = model("Mission", missionSchema)

const progressSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    mission: { type: Types.ObjectId, ref: "Mission", required: true },
    // Day key for daily missions, week key for weekly ones
    periodKey: { type: String, required: true },
    progress: { type: Number, default: 0 },
    completedAt: { type: Date },
    claimedAt: { type: Date },
  },
  { timestamps: true },
)

progressSchema.index({ user: 1, mission: 1, periodKey: 1 }, { unique: true })

export const MissionProgressModel = model("MissionProgress", progressSchema)

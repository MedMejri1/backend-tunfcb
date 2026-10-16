import { Schema, model, Types, type InferSchemaType } from "mongoose"

export const INJURY_SEVERITIES = ["minor", "moderate", "severe"] as const

// ESPN publishes no injuries for LaLiga: the team keeps the infirmary up to date from the dashboard.
const injurySchema = new Schema(
  {
    playerId: { type: String, required: true, index: true }, // ESPN athlete id
    playerName: { type: String, required: true, trim: true },
    position: { type: String, default: "", trim: true },
    injuryType: { type: String, required: true, trim: true, maxlength: 120 },
    expectedReturn: { type: Date, default: null },
    returnNote: { type: String, default: "", trim: true, maxlength: 80 },
    severity: { type: String, enum: INJURY_SEVERITIES, default: "moderate" },
    // false = player back: kept for the history.
    active: { type: Boolean, default: true, index: true },
    healedAt: Date,
    updatedBy: { type: Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true },
)

export type Injury = InferSchemaType<typeof injurySchema>
export const InjuryModel = model("Injury", injurySchema)

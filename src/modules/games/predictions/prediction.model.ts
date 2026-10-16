import { Schema, model, type InferSchemaType, Types } from "mongoose"

const teamSchema = new Schema(
  { id: String, name: { type: String, required: true }, short: { type: String, required: true }, logo: String },
  { _id: false },
)

const matchSchema = new Schema(
  {
    // Absent for matches created by hand in the dashboard
    espnEventId: { type: String, unique: true, sparse: true },
    competition: { type: String, required: true },
    home: { type: teamSchema, required: true },
    away: { type: teamSchema, required: true },
    kickoff: { type: Date, required: true, index: true },
    venue: { type: String },
    status: { type: String, enum: ["open", "closed", "settled", "cancelled"], default: "open", index: true },
    result: { home: Number, away: Number },
    settledAt: { type: Date },
    predictionsCount: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export type PredictionMatch = InferSchemaType<typeof matchSchema>
export const PredictionMatchModel = model("PredictionMatch", matchSchema)

const predictionSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    match: { type: Types.ObjectId, ref: "PredictionMatch", required: true },
    home: { type: Number, required: true, min: 0, max: 20 },
    away: { type: Number, required: true, min: 0, max: 20 },
    outcome: { type: String, enum: ["pending", "exact", "correct", "wrong", "void"], default: "pending" },
    pointsAwarded: { type: Number, default: 0 },
  },
  { timestamps: true },
)

predictionSchema.index({ user: 1, match: 1 }, { unique: true })
predictionSchema.index({ match: 1, outcome: 1 })

export const PredictionModel = model("Prediction", predictionSchema)

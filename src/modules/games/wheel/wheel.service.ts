import { Schema, model, Types } from "mongoose"
import { HttpError } from "../../../middlewares/errorHandler.js"
import { weightedIndex } from "../../../utils/random.js"
import { awardPoints } from "../../points/points.service.js"
import { getSettings } from "../../settings/settings.service.js"
import { UserModel, type UserDocument } from "../../users/user.model.js"
import { trackEventSafe } from "../missions/missions.service.js"

// Every spin, including "lost" ones that create no transaction.
const spinSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true, index: true },
    segmentIndex: { type: Number, required: true },
    label: { type: String, required: true },
    points: { type: Number, required: true },
    // Set when the prize was doubled with a rewarded ad (once per spin).
    doubledAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
spinSchema.index({ createdAt: -1 })
export const WheelSpinModel = model("WheelSpin", spinSchema)

const nextSpinAt = (last: Date | undefined | null, cooldownHours: number) =>
  last ? new Date(last.getTime() + cooldownHours * 3_600_000) : null

export async function getWheelStatus(user: UserDocument) {
  const { wheel } = await getSettings()
  const next = nextSpinAt(user.games?.wheelLastSpinAt, wheel.cooldownHours)
  const available = !next || next.getTime() <= Date.now()
  return {
    available,
    nextAvailableAt: available ? null : next,
    cooldownHours: wheel.cooldownHours,
    segments: wheel.segments.map(({ label, points, color }) => ({ label, points, color })),
  }
}

export async function spinWheel(user: UserDocument) {
  const { wheel } = await getSettings()
  const now = new Date()
  const threshold = new Date(now.getTime() - wheel.cooldownHours * 3_600_000)

  // Claim the spin atomically: concurrent requests can't both pass the cooldown.
  const locked = await UserModel.findOneAndUpdate(
    {
      _id: user._id,
      $or: [{ "games.wheelLastSpinAt": { $exists: false } }, { "games.wheelLastSpinAt": { $lte: threshold } }],
    },
    { "games.wheelLastSpinAt": now },
  )
  if (!locked) {
    const next = nextSpinAt(user.games?.wheelLastSpinAt, wheel.cooldownHours)
    throw new HttpError(429, "La roue n'est pas encore disponible", { nextAvailableAt: next })
  }

  const segmentIndex = weightedIndex(wheel.segments.map((s) => s.weight))
  const segment = wheel.segments[segmentIndex]
  const spin = await WheelSpinModel.create({
    user: user._id,
    segmentIndex,
    label: segment.label,
    points: segment.points,
  })

  if (segment.points > 0) {
    await awardPoints({
      userId: user._id,
      type: "wheel",
      points: segment.points,
      title: "Roue de la chance",
      detail: `Lot : ${segment.label}`,
      ref: String(spin._id),
    })
  }
  trackEventSafe(user._id, "wheel_spun")

  return {
    segmentIndex,
    label: segment.label,
    points: segment.points,
    nextAvailableAt: nextSpinAt(now, wheel.cooldownHours),
  }
}

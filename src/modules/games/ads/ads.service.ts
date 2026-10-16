import { HttpError } from "../../../middlewares/errorHandler.js"
import { dayKey } from "../../../utils/dates.js"
import { awardPoints } from "../../points/points.service.js"
import { getSettings } from "../../settings/settings.service.js"
import { UserModel, type UserDocument } from "../../users/user.model.js"
import { trackEventSafe } from "../missions/missions.service.js"
import { QuizAttemptModel } from "../quiz/quiz.model.js"
import { WheelSpinModel } from "../wheel/wheel.service.js"

export async function getAdsStatus(user: UserDocument) {
  const { ads } = await getSettings()
  const watched = user.games?.adsDay === dayKey() ? (user.games?.adsCount ?? 0) : 0
  const lastAt = user.games?.lastAdAt
  const next = lastAt ? new Date(lastAt.getTime() + ads.cooldownSeconds * 1000) : null
  return {
    reward: ads.rewardPerAd,
    total: ads.maxPerDay,
    remaining: Math.max(0, ads.maxPerDay - watched),
    nextAvailableAt: next && next.getTime() > Date.now() ? next : null,
  }
}

/**
 * Credits a watched rewarded ad. The client reports the view; for production,
 * AdMob server-side verification (SSV) should call this instead of the app.
 */
export async function rewardAd(user: UserDocument) {
  const { ads } = await getSettings()
  const today = dayKey()
  const now = new Date()

  // New day: reset the counter (atomic, only once).
  await UserModel.updateOne(
    { _id: user._id, "games.adsDay": { $ne: today } },
    { "games.adsDay": today, "games.adsCount": 0 },
  )

  const updated = await UserModel.findOneAndUpdate(
    {
      _id: user._id,
      "games.adsDay": today,
      "games.adsCount": { $lt: ads.maxPerDay },
      $or: [
        { "games.lastAdAt": { $exists: false } },
        { "games.lastAdAt": { $lte: new Date(now.getTime() - ads.cooldownSeconds * 1000) } },
      ],
    },
    { $inc: { "games.adsCount": 1 }, "games.lastAdAt": now },
    { returnDocument: "after" },
  )
  if (!updated) {
    throw new HttpError(429, "Limite de publicités atteinte, reviens plus tard")
  }

  if (ads.rewardPerAd > 0) {
    await awardPoints({
      userId: user._id,
      type: "ad",
      points: ads.rewardPerAd,
      title: "Publicité regardée",
      detail: `${updated.games?.adsCount}/${ads.maxPerDay} aujourd'hui`,
    })
  }
  trackEventSafe(user._id, "ad_watched")

  return getAdsStatus(updated)
}

export type DoubleGame = "quiz" | "wheel"

/**
 * After a rewarded ad, credits today's quiz points or the latest wheel prize
 * a second time. The `doubledAt` flag is set atomically so it works only once.
 */
export async function doubleGameReward(user: UserDocument, game: DoubleGame) {
  const { ads } = await getSettings()
  if (!ads.doubleRewards) throw new HttpError(403, "Le doublement des gains est désactivé")
  const now = new Date()

  let reward: { points: number; ref: string; detail: string } | null = null
  if (game === "quiz") {
    const attempt = await QuizAttemptModel.findOneAndUpdate(
      { user: user._id, dayKey: dayKey(), pointsAwarded: { $gt: 0 }, doubledAt: { $exists: false } },
      { doubledAt: now },
    )
    if (attempt) reward = { points: attempt.pointsAwarded, ref: String(attempt._id), detail: "Quiz du jour" }
  } else {
    // Only the latest spin can be doubled.
    const latest = await WheelSpinModel.findOne({ user: user._id }).sort({ createdAt: -1 }).select("_id").lean()
    const spin = latest
      ? await WheelSpinModel.findOneAndUpdate(
          { _id: latest._id, points: { $gt: 0 }, doubledAt: { $exists: false } },
          { doubledAt: now },
        )
      : null
    if (spin) reward = { points: spin.points, ref: String(spin._id), detail: `Roue : ${spin.label}` }
  }
  if (!reward) throw new HttpError(409, "Ces gains ont déjà été doublés")

  await awardPoints({
    userId: user._id,
    type: "ad",
    points: reward.points,
    title: "Gains doublés",
    detail: reward.detail,
    ref: reward.ref,
  })
  trackEventSafe(user._id, "ad_watched")
  return { points: reward.points }
}

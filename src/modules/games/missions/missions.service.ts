import { Types } from "mongoose"
import { HttpError } from "../../../middlewares/errorHandler.js"
import { dayKey, weekKey } from "../../../utils/dates.js"
import { awardPoints } from "../../points/points.service.js"
import { MissionModel, MissionProgressModel, type MissionEvent } from "./mission.model.js"

type UserId = Types.ObjectId | string

const periodKeyFor = (scope: string) => (scope === "daily" ? dayKey() : weekKey())

/** Advances every active mission listening to `event` for the current period. */
export async function trackEvent(userId: UserId, event: MissionEvent, amount = 1): Promise<void> {
  const missions = await MissionModel.find({ active: true, event }).lean()
  await Promise.all(
    missions.map(async (mission) => {
      const progress = await MissionProgressModel.findOneAndUpdate(
        { user: userId, mission: mission._id, periodKey: periodKeyFor(mission.scope) },
        { $inc: { progress: amount } },
        { upsert: true, returnDocument: "after" },
      )
      if (progress && !progress.completedAt && progress.progress >= mission.target) {
        await MissionProgressModel.updateOne(
          { _id: progress._id, completedAt: { $exists: false } },
          { completedAt: new Date() },
        )
      }
    }),
  )
}

/** Fire-and-forget variant for game flows: a mission hiccup must not fail the game. */
export function trackEventSafe(userId: UserId, event: MissionEvent, amount = 1): void {
  trackEvent(userId, event, amount).catch((err) => console.error("[missions] trackEvent", err))
}

export async function listMissionsForUser(userId: UserId) {
  const missions = await MissionModel.find({ active: true }).sort({ scope: 1, order: 1, createdAt: 1 }).lean()
  const progress = await MissionProgressModel.find({
    user: userId,
    mission: { $in: missions.map((m) => m._id) },
    periodKey: { $in: [dayKey(), weekKey()] },
  }).lean()

  return missions.map((mission) => {
    const p = progress.find(
      (x) => x.mission.equals(mission._id) && x.periodKey === periodKeyFor(mission.scope),
    )
    const value = Math.min(p?.progress ?? 0, mission.target)
    return {
      id: String(mission._id),
      scope: mission.scope,
      event: mission.event,
      title: mission.title,
      description: mission.description,
      icon: mission.icon,
      color: mission.color,
      progress: value,
      target: mission.target,
      reward: mission.reward,
      completed: value >= mission.target,
      claimed: !!p?.claimedAt,
    }
  })
}

export async function claimMission(userId: UserId, missionId: string) {
  const mission = await MissionModel.findOne({ _id: missionId, active: true })
  if (!mission) throw new HttpError(404, "Mission introuvable")

  // Atomic: only one request can flip claimedAt for a completed mission.
  const progress = await MissionProgressModel.findOneAndUpdate(
    {
      user: userId,
      mission: mission._id,
      periodKey: periodKeyFor(mission.scope),
      progress: { $gte: mission.target },
      claimedAt: { $exists: false },
    },
    { claimedAt: new Date() },
    { returnDocument: "after" },
  )
  if (!progress) throw new HttpError(400, "Mission non terminée ou déjà réclamée")

  if (mission.reward > 0) {
    try {
      return await awardPoints({
        userId,
        type: "mission",
        points: mission.reward,
        title: `Mission : ${mission.title}`,
        detail: mission.scope === "daily" ? "Mission du jour" : "Mission de la semaine",
        ref: String(progress._id),
      })
    } catch (err) {
      await MissionProgressModel.updateOne({ _id: progress._id }, { $unset: { claimedAt: 1 } })
      throw err
    }
  }
  return null
}

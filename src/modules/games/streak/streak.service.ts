import { HttpError } from "../../../middlewares/errorHandler.js"
import { addDays, dayKey, previousDayKey, startOfDay, zonedParts } from "../../../utils/dates.js"
import { awardPoints } from "../../points/points.service.js"
import { getSettings } from "../../settings/settings.service.js"
import { UserModel, type UserDocument } from "../../users/user.model.js"
import { trackEventSafe } from "../missions/missions.service.js"

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

/** Streak value today's claim gives (or gave): continues from yesterday, else restarts at 1. */
function todaysStreakValue(user: UserDocument, today: string) {
  const last = user.streak?.lastClaimDay
  const current = user.streak?.current ?? 0
  if (last === today) return { value: current, claimedToday: true }
  if (last === previousDayKey(today)) return { value: current + 1, claimedToday: false }
  return { value: 1, claimedToday: false }
}

/** The 7-day reward cycle around today, as shown in the app. */
export async function getStreakStatus(user: UserDocument) {
  const { streakRewards } = await getSettings()
  const today = dayKey()
  const { value, claimedToday } = todaysStreakValue(user, today)
  const position = (value - 1) % 7
  const midnight = startOfDay()

  const days = streakRewards.map((reward, i) => {
    const date = addDays(midnight, i - position + 0.5)
    const parts = zonedParts(date)
    let status: "claimed" | "today" | "upcoming"
    if (i < position) status = "claimed"
    else if (i === position) status = claimedToday ? "claimed" : "today"
    else status = "upcoming"
    return { day: DAY_LABELS[parts.weekday], date: parts.day, reward, status }
  })

  return {
    current: claimedToday ? value : user.streak?.lastClaimDay === previousDayKey(today) ? value - 1 : 0,
    best: user.streak?.best ?? 0,
    canClaim: !claimedToday,
    todayReward: streakRewards[position],
    days,
  }
}

export async function claimStreak(user: UserDocument) {
  const { streakRewards } = await getSettings()
  const today = dayKey()
  const { value, claimedToday } = todaysStreakValue(user, today)
  if (claimedToday) throw new HttpError(409, "Bonus du jour déjà récupéré")

  // Only one request per day can pass this filter.
  const updated = await UserModel.findOneAndUpdate(
    { _id: user._id, "streak.lastClaimDay": { $ne: today } },
    {
      "streak.current": value,
      "streak.lastClaimDay": today,
      "streak.best": Math.max(value, user.streak?.best ?? 0),
    },
    { returnDocument: "after" },
  )
  if (!updated) throw new HttpError(409, "Bonus du jour déjà récupéré")

  const reward = streakRewards[(value - 1) % 7]
  if (reward > 0) {
    await awardPoints({
      userId: user._id,
      type: "streak",
      points: reward,
      title: "Bonus quotidien",
      detail: `Série de ${value} jour${value > 1 ? "s" : ""}`,
    })
  }
  trackEventSafe(user._id, "streak_claimed")

  return { reward, streak: value, status: await getStreakStatus(updated) }
}

import type { RequestHandler } from "express"
import { z } from "zod"
import { env } from "../../config/env.js"
import { addDays, dayKey, startOfDay, startOfPeriod } from "../../utils/dates.js"
import { PredictionMatchModel, PredictionModel } from "../games/predictions/prediction.model.js"
import { QuizAttemptModel } from "../games/quiz/quiz.model.js"
import { WheelSpinModel } from "../games/wheel/wheel.service.js"
import { getLeaderboard } from "../leaderboard/leaderboard.service.js"
import { TransactionModel } from "../points/transaction.model.js"
import { UserModel } from "../users/user.model.js"

const earnedMatch = (since: Date) => ({ createdAt: { $gte: since }, type: { $ne: "spent" }, points: { $gt: 0 } })

async function sumPoints(since: Date): Promise<number> {
  const [row] = await TransactionModel.aggregate<{ total: number }>([
    { $match: earnedMatch(since) },
    { $group: { _id: null, total: { $sum: "$points" } } },
  ])
  return row?.total ?? 0
}

export const overview: RequestHandler = async (req, res) => {
  const days = z.coerce.number().int().min(7).max(90).default(30).parse(req.query.days)
  const today = startOfDay()
  const since = addDays(today, -(days - 1))
  const day = (d: number) => addDays(today, -d)
  const dateKey = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: env.APP_TIMEZONE } }

  const [
    total,
    banned,
    newToday,
    new7d,
    new30d,
    activeToday,
    active7d,
    circulating,
    distributedToday,
    distributed7d,
    distributed30d,
    quizToday,
    wheelToday,
    adsToday,
    predictionsToday,
    openMatches,
    signupsSeries,
    pointsSeries,
    pointsByType,
    topWeek,
    recentUsers,
  ] = await Promise.all([
    UserModel.countDocuments(),
    UserModel.countDocuments({ status: "banned" }),
    UserModel.countDocuments({ createdAt: { $gte: today } }),
    UserModel.countDocuments({ createdAt: { $gte: day(6) } }),
    UserModel.countDocuments({ createdAt: { $gte: day(29) } }),
    UserModel.countDocuments({ lastActiveAt: { $gte: today } }),
    UserModel.countDocuments({ lastActiveAt: { $gte: day(6) } }),
    UserModel.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$balance" } } }]),
    sumPoints(today),
    sumPoints(day(6)),
    sumPoints(day(29)),
    QuizAttemptModel.countDocuments({ dayKey: dayKey() }),
    WheelSpinModel.countDocuments({ createdAt: { $gte: today } }),
    TransactionModel.countDocuments({ type: "ad", createdAt: { $gte: today } }),
    PredictionModel.countDocuments({ createdAt: { $gte: today } }),
    PredictionMatchModel.countDocuments({ status: "open" }),
    UserModel.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: dateKey, count: { $sum: 1 } } },
    ]),
    TransactionModel.aggregate<{ _id: string; points: number; players: number }>([
      { $match: earnedMatch(since) },
      { $group: { _id: dateKey, points: { $sum: "$points" }, users: { $addToSet: "$user" } } },
      { $project: { points: 1, players: { $size: "$users" } } },
    ]),
    TransactionModel.aggregate<{ _id: string; points: number; count: number }>([
      { $match: earnedMatch(since) },
      { $group: { _id: "$type", points: { $sum: "$points" }, count: { $sum: 1 } } },
      { $sort: { points: -1 } },
    ]),
    getLeaderboard({ period: "week", page: 1, limit: 5 }),
    UserModel.find().sort({ createdAt: -1 }).limit(6).select("firstName lastName username country createdAt").lean(),
  ])

  const timeseries = Array.from({ length: days }, (_, i) => {
    const key = dayKey(addDays(since, i + 0.5))
    const pts = pointsSeries.find((p) => p._id === key)
    return {
      day: key,
      signups: signupsSeries.find((s) => s._id === key)?.count ?? 0,
      points: pts?.points ?? 0,
      players: pts?.players ?? 0,
    }
  })

  res.json({
    users: { total, banned, newToday, new7d, new30d, activeToday, active7d },
    points: {
      circulating: circulating[0]?.total ?? 0,
      distributedToday,
      distributed7d,
      distributed30d,
    },
    games: { quizToday, wheelToday, adsToday, predictionsToday, openMatches },
    timeseries,
    pointsByType: pointsByType.map((t) => ({ type: t._id, points: t.points, count: t.count })),
    weekStart: startOfPeriod("week"),
    topWeek: topWeek.items,
    recentUsers: recentUsers.map((u) => ({
      id: String(u._id),
      name: [u.firstName, u.lastName].filter(Boolean).join(" "),
      username: u.username,
      country: u.country,
      createdAt: u.createdAt,
    })),
  })
}

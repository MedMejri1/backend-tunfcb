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
import { CafeModel } from "../cafes/cafe.model.js"
import { OrderModel } from "../shop/order.model.js"
import { SupportTicketModel } from "../support/support.model.js"
import { WallCommentModel, WallPostModel, WallReactionModel } from "../wall/wall.model.js"
import { GuestDeviceModel, PushLogModel } from "../push/push.model.js"
import { HAS_DEVICE } from "../push/push.service.js"
import { InjuryModel } from "../team/injury.model.js"
import { getSettings } from "../settings/settings.service.js"

const earnedMatch = (since: Date) => ({ createdAt: { $gte: since }, type: { $ne: "spent" }, points: { $gt: 0 } })

async function sumPoints(since: Date): Promise<number> {
  const [row] = await TransactionModel.aggregate<{ total: number }>([
    { $match: earnedMatch(since) },
    { $group: { _id: null, total: { $sum: "$points" } } },
  ])
  return row?.total ?? 0
}

/** Work waiting for the team: each count links to its page on the dashboard. */
async function todoStats() {
  const [cafesPending, ordersPending, supportOpen, wallReported] = await Promise.all([
    CafeModel.countDocuments({ status: "pending" }),
    OrderModel.countDocuments({ status: "pending" }),
    SupportTicketModel.countDocuments({ status: "open" }),
    WallPostModel.countDocuments({ $or: [{ pendingReports: { $gt: 0 } }, { pendingCommentReports: { $gt: 0 } }] }),
  ])
  return { cafesPending, ordersPending, supportOpen, wallReported }
}

async function wallStats(today: Date, weekAgo: Date) {
  const [postsToday, posts7d, comments7d, reactions7d, posters7d, hidden] = await Promise.all([
    WallPostModel.countDocuments({ createdAt: { $gte: today } }),
    WallPostModel.countDocuments({ createdAt: { $gte: weekAgo } }),
    WallCommentModel.countDocuments({ createdAt: { $gte: weekAgo } }),
    WallReactionModel.countDocuments({ createdAt: { $gte: weekAgo } }),
    WallPostModel.distinct("author", { createdAt: { $gte: weekAgo } }),
    WallPostModel.countDocuments({ status: "hidden" }),
  ])
  return { postsToday, posts7d, comments7d, reactions7d, posters7d: posters7d.length, hidden }
}

async function cafeStats() {
  const [approved, byGovernorate] = await Promise.all([
    CafeModel.countDocuments({ status: "approved" }),
    CafeModel.aggregate<{ _id: string; count: number }>([
      { $match: { status: "approved" } },
      { $group: { _id: "$governorateName", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 6 },
    ]),
  ])
  return { approved, byGovernorate: byGovernorate.map((g) => ({ name: g._id, count: g.count })) }
}

async function shopStats() {
  const [monthOrders, revenue, { shop }] = await Promise.all([
    OrderModel.countDocuments({ createdAt: { $gte: startOfPeriod("month") }, status: { $ne: "cancelled" } }),
    OrderModel.aggregate<{ total: number }>([
      { $match: { status: "delivered" } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    getSettings(),
  ])
  return { open: shop.enabled, monthOrders, deliveredRevenue: revenue[0]?.total ?? 0 }
}

/** Who the app can reach: phones registered for push, guest-mode phones, the infirmary. */
async function audienceStats(weekAgo: Date) {
  const [pushMembers, guests, guestsActive7d, lastReminder, injured] = await Promise.all([
    UserModel.countDocuments({ status: "active", ...HAS_DEVICE }),
    GuestDeviceModel.countDocuments(),
    GuestDeviceModel.countDocuments({ lastSeenAt: { $gte: weekAgo } }),
    PushLogModel.findOne().sort({ createdAt: -1 }).lean(),
    InjuryModel.countDocuments({ active: true }),
  ])
  return {
    pushMembers,
    guests,
    guestsActive7d,
    // key = "morning:2026-10-17" / "evening:…"
    lastReminder: lastReminder
      ? { kind: lastReminder.key.split(":")[0], sent: lastReminder.sent, at: lastReminder.createdAt }
      : null,
    injured,
  }
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
    wallSeries,
    todo,
    wall,
    cafes,
    shop,
    audience,
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
    WallPostModel.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: dateKey, count: { $sum: 1 } } },
    ]),
    todoStats(),
    wallStats(today, day(6)),
    cafeStats(),
    shopStats(),
    audienceStats(day(6)),
  ])

  const timeseries = Array.from({ length: days }, (_, i) => {
    const key = dayKey(addDays(since, i + 0.5))
    const pts = pointsSeries.find((p) => p._id === key)
    return {
      day: key,
      signups: signupsSeries.find((s) => s._id === key)?.count ?? 0,
      points: pts?.points ?? 0,
      players: pts?.players ?? 0,
      posts: wallSeries.find((w) => w._id === key)?.count ?? 0,
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
    todo,
    wall,
    cafes,
    shop,
    audience,
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

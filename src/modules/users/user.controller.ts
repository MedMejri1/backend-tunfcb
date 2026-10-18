import type { RequestHandler } from "express"
import { z } from "zod"
import { startOfPeriod } from "../../utils/dates.js"
import { paginated, paginationSchema } from "../../utils/pagination.js"
import { MissionProgressModel } from "../games/missions/mission.model.js"
import { PredictionModel } from "../games/predictions/prediction.model.js"
import { QuizAttemptModel } from "../games/quiz/quiz.model.js"
import { WheelSpinModel } from "../games/wheel/wheel.service.js"
import { getUserPosition } from "../leaderboard/leaderboard.service.js"
import { getSettings } from "../settings/settings.service.js"
import { TRANSACTION_TYPES, TransactionModel } from "../points/transaction.model.js"
import { UserModel } from "./user.model.js"

/** Mobile: lifetime and weekly stats (profile, badges). */
export const myStats: RequestHandler = async (req, res) => {
  const user = req.appUser!
  const weekStart = startOfPeriod("week")

  const [quiz, predictions, wheelSpins, adsWatched, missionsClaimed, weekByType, weekPosition] = await Promise.all([
    QuizAttemptModel.aggregate<{ played: number; correct: number; questions: number; perfect: number }>([
      { $match: { user: user._id } },
      {
        $group: {
          _id: null,
          played: { $sum: 1 },
          correct: { $sum: "$correctCount" },
          questions: { $sum: "$total" },
          perfect: { $sum: { $cond: [{ $eq: ["$correctCount", "$total"] }, 1, 0] } },
        },
      },
    ]),
    PredictionModel.aggregate<{ _id: string; count: number }>([
      { $match: { user: user._id } },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
    ]),
    WheelSpinModel.countDocuments({ user: user._id }),
    TransactionModel.countDocuments({ user: user._id, type: "ad" }),
    MissionProgressModel.countDocuments({ user: user._id, claimedAt: { $exists: true } }),
    TransactionModel.aggregate<{ _id: string; points: number; count: number }>([
      { $match: { user: user._id, createdAt: { $gte: weekStart }, type: { $ne: "spent" } } },
      { $group: { _id: "$type", points: { $sum: "$points" }, count: { $sum: 1 } } },
    ]),
    getUserPosition(user._id, "week"),
  ])

  const q = quiz[0]
  const outcome = (o: string) => predictions.find((p) => p._id === o)?.count ?? 0
  const week = (type: string) => weekByType.find((t) => t._id === type)

  res.json({
    totals: {
      quizPlayed: q?.played ?? 0,
      quizPerfect: q?.perfect ?? 0,
      quizAccuracy: q?.questions ? Math.round((q.correct / q.questions) * 100) : 0,
      predictions: predictions.reduce((sum, p) => sum + p.count, 0),
      predictionsExact: outcome("exact"),
      predictionsCorrect: outcome("correct"),
      wheelSpins,
      adsWatched,
      missionsClaimed,
      referrals: user.referralsCount,
      bestStreak: user.streak?.best ?? 0,
    },
    week: {
      points: weekByType.reduce((sum, t) => sum + t.points, 0),
      rank: weekPosition.rank,
      quizPlayed: week("quiz")?.count ?? 0,
      predictionsWon: week("prediction")?.count ?? 0,
      adsWatched: week("ad")?.count ?? 0,
      wheelSpins: week("wheel")?.count ?? 0,
    },
  })
}

const historySchema = paginationSchema.extend({
  type: z.enum(TRANSACTION_TYPES).optional(),
  // "Gagnés" / "Dépensés" tabs: filtered here so each page is full.
  direction: z.enum(["earned", "spent"]).optional(),
})

/** Mobile: the user's points history, newest first, page by page. */
export const myTransactions: RequestHandler = async (req, res) => {
  const { page, limit, type, direction } = historySchema.parse(req.query)
  const filter = {
    user: req.appUser!._id,
    ...(type ? { type } : {}),
    ...(direction ? { points: direction === "earned" ? { $gt: 0 } : { $lt: 0 } } : {}),
  }
  const [items, total] = await Promise.all([
    TransactionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    TransactionModel.countDocuments(filter),
  ])
  res.json(
    paginated(
      items.map((t) => ({
        id: String(t._id),
        type: t.type,
        title: t.title,
        detail: t.detail,
        points: t.points,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt,
      })),
      total,
      page,
      limit,
    ),
  )
}

const ACTIVE_WINDOW_MS = 7 * 86_400_000

/** Mobile: friends who signed up with the user's code. */
export const myReferrals: RequestHandler = async (req, res) => {
  const user = req.appUser!
  const referrals = await UserModel.find({ referredBy: user._id }).sort({ createdAt: -1 }).limit(100).lean()
  const earned = await TransactionModel.find({
    user: user._id,
    type: "referral",
    ref: { $in: referrals.map((r) => String(r._id)) },
  }).lean()

  const { referral } = await getSettings()
  res.json({
    referralCode: user.referralCode,
    count: user.referralsCount,
    rewards: referral,
    items: referrals.map((r) => ({
      id: String(r._id),
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      initials: `${r.firstName?.[0] ?? ""}${r.lastName?.[0] ?? ""}`.toUpperCase(),
      joinedAt: r.createdAt,
      status:
        r.status === "banned"
          ? "inactive"
          : r.lastActiveAt && Date.now() - r.lastActiveAt.getTime() < ACTIVE_WINDOW_MS
            ? "active"
            : "inactive",
      pointsEarned: earned.filter((t) => t.ref === String(r._id)).reduce((sum, t) => sum + t.points, 0),
    })),
  })
}

import type { RequestHandler } from "express"
import bcrypt from "bcryptjs"
import { Types } from "mongoose"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { escapeRegex, paginated, paginationSchema } from "../../utils/pagination.js"
import { getUserPosition } from "../leaderboard/leaderboard.service.js"
import { awardPoints } from "../points/points.service.js"
import { TransactionModel } from "../points/transaction.model.js"
import { getSettings, levelForXp } from "../settings/settings.service.js"
import { MissionProgressModel } from "../games/missions/mission.model.js"
import { PredictionMatchModel, PredictionModel } from "../games/predictions/prediction.model.js"
import { QuizAttemptModel } from "../games/quiz/quiz.model.js"
import { WheelSpinModel } from "../games/wheel/wheel.service.js"
import { NotificationModel } from "../notifications/notification.model.js"
import { deleteOrdersOfUser } from "../shop/shop.service.js"
import { SupportTicketModel } from "../support/support.model.js"
import { UserModel, type User } from "./user.model.js"

type LeanUser = User & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }

async function presentAdminUser(u: LeanUser) {
  const { levels } = await getSettings()
  return {
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    name: [u.firstName, u.lastName].filter(Boolean).join(" "),
    username: u.username,
    email: u.email,
    city: u.city,
    country: u.country,
    status: u.status,
    banReason: u.banReason,
    bannedAt: u.bannedAt,
    balance: u.balance,
    xp: u.xp,
    ...levelForXp(u.xp, levels),
    streak: u.streak?.current ?? 0,
    bestStreak: u.streak?.best ?? 0,
    referralCode: u.referralCode,
    referralsCount: u.referralsCount,
    lastActiveAt: u.lastActiveAt,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    isDemo: u.isDemo,
  }
}

const SORTS = {
  recent: { createdAt: -1 },
  oldest: { createdAt: 1 },
  xp: { xp: -1 },
  balance: { balance: -1 },
  active: { lastActiveAt: -1 },
} as const

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  status: z.enum(["active", "banned"]).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default("recent"),
})

export const listUsers: RequestHandler = async (req, res) => {
  const q = listSchema.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (q.status) filter.status = q.status
  if (q.country) filter.country = q.country
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), "i")
    filter.$or = [{ firstName: rx }, { lastName: rx }, { username: rx }, { email: rx }, { referralCode: rx }]
  }

  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .sort(SORTS[q.sort])
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    UserModel.countDocuments(filter),
  ])
  const items = await Promise.all(users.map((u) => presentAdminUser(u as LeanUser)))
  res.json(paginated(items, total, q.page, q.limit))
}

export const getUser: RequestHandler = async (req, res) => {
  const user = await UserModel.findById(req.params.id).lean()
  if (!user) throw new HttpError(404, "Utilisateur introuvable")
  const userId = user._id

  const [byType, quiz, predictions, wheelSpins, recent, referrals, referrer, rankAll, rankWeek] = await Promise.all([
    TransactionModel.aggregate<{ _id: string; points: number; count: number }>([
      { $match: { user: userId } },
      { $group: { _id: "$type", points: { $sum: "$points" }, count: { $sum: 1 } } },
      { $sort: { points: -1 } },
    ]),
    QuizAttemptModel.aggregate<{ played: number; correct: number; questions: number; perfect: number }>([
      { $match: { user: userId } },
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
      { $match: { user: userId } },
      { $group: { _id: "$outcome", count: { $sum: 1 } } },
    ]),
    WheelSpinModel.countDocuments({ user: userId }),
    TransactionModel.find({ user: userId }).sort({ createdAt: -1 }).limit(25).lean(),
    UserModel.find({ referredBy: userId }).sort({ createdAt: -1 }).limit(20).lean(),
    user.referredBy ? UserModel.findById(user.referredBy).select("firstName lastName username").lean() : null,
    getUserPosition(userId, "all"),
    getUserPosition(userId, "week"),
  ])

  const quizStats = quiz[0]
  const predictionCount = (outcome: string) => predictions.find((p) => p._id === outcome)?.count ?? 0

  res.json({
    user: await presentAdminUser(user as LeanUser),
    ranks: { all: rankAll.rank, week: rankWeek.rank, weekPoints: rankWeek.points },
    pointsByType: byType.map((t) => ({ type: t._id, points: t.points, count: t.count })),
    games: {
      quiz: {
        played: quizStats?.played ?? 0,
        perfect: quizStats?.perfect ?? 0,
        accuracy: quizStats?.questions ? Math.round((quizStats.correct / quizStats.questions) * 100) : 0,
      },
      predictions: {
        total: predictions.reduce((s, p) => s + p.count, 0),
        exact: predictionCount("exact"),
        correct: predictionCount("correct"),
        wrong: predictionCount("wrong"),
        pending: predictionCount("pending"),
      },
      wheelSpins,
      adsWatchedToday: user.games?.adsDay ? user.games.adsCount : 0,
    },
    referrer: referrer
      ? { id: String(referrer._id), name: [referrer.firstName, referrer.lastName].filter(Boolean).join(" "), username: referrer.username }
      : null,
    referrals: referrals.map((r) => ({
      id: String(r._id),
      name: [r.firstName, r.lastName].filter(Boolean).join(" "),
      username: r.username,
      createdAt: r.createdAt,
    })),
    recentTransactions: recent.map((t) => ({
      id: String(t._id),
      type: t.type,
      title: t.title,
      detail: t.detail,
      points: t.points,
      balanceAfter: t.balanceAfter,
      createdAt: t.createdAt,
    })),
  })
}

const updateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    city: z.string().trim().max(60).optional(),
    country: z.string().trim().length(2).toUpperCase().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à mettre à jour" })

export const updateUser: RequestHandler = async (req, res) => {
  const input = updateSchema.parse(req.body)
  const user = await UserModel.findByIdAndUpdate(req.params.id, input, { returnDocument: "after" }).lean()
  if (!user) throw new HttpError(404, "Utilisateur introuvable")
  res.json({ user: await presentAdminUser(user as LeanUser) })
}

const statusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active") }),
  z.object({ status: z.literal("banned"), reason: z.string().trim().min(3, "Motif requis").max(300) }),
])

export const setUserStatus: RequestHandler = async (req, res) => {
  const input = statusSchema.parse(req.body)
  const update =
    input.status === "banned"
      ? { status: "banned", banReason: input.reason, bannedAt: new Date() }
      : { status: "active", $unset: { banReason: 1, bannedAt: 1 } }
  const user = await UserModel.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" }).lean()
  if (!user) throw new HttpError(404, "Utilisateur introuvable")
  res.json({ user: await presentAdminUser(user as LeanUser) })
}

const adjustSchema = z.object({
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0, { message: "Montant non nul requis" })
    .refine((n) => Math.abs(n) <= 100_000, { message: "Montant trop élevé" }),
  reason: z.string().trim().min(3, "Motif requis").max(300),
})

export const adjustUserPoints: RequestHandler = async (req, res) => {
  const { amount, reason } = adjustSchema.parse(req.body)
  const { user, transaction } = await awardPoints({
    userId: String(req.params.id),
    type: "admin",
    points: amount,
    title: amount > 0 ? "Bonus administrateur" : "Correction administrateur",
    detail: reason,
    adminId: req.admin!._id,
  })
  res.json({
    user: await presentAdminUser(user.toObject() as LeanUser),
    transaction: { id: String(transaction._id), points: transaction.points, balanceAfter: transaction.balanceAfter },
  })
}

const passwordSchema = z.object({ password: z.string().min(8).max(128) })

export const resetUserPassword: RequestHandler = async (req, res) => {
  const { password } = passwordSchema.parse(req.body)
  const updated = await UserModel.updateOne({ _id: req.params.id }, { passwordHash: await bcrypt.hash(password, 12) })
  if (updated.matchedCount === 0) throw new HttpError(404, "Utilisateur introuvable")
  res.json({ ok: true })
}

export const deleteUser: RequestHandler = async (req, res) => {
  const user = await UserModel.findById(req.params.id)
  if (!user) throw new HttpError(404, "Utilisateur introuvable")
  const userId = user._id

  const predictionMatches = await PredictionModel.find({ user: userId, outcome: "pending" }).distinct("match")
  await deleteOrdersOfUser(userId)
  await Promise.all([
    TransactionModel.deleteMany({ user: userId }),
    QuizAttemptModel.deleteMany({ user: userId }),
    PredictionModel.deleteMany({ user: userId }),
    MissionProgressModel.deleteMany({ user: userId }),
    WheelSpinModel.deleteMany({ user: userId }),
    NotificationModel.deleteMany({ user: userId }),
    SupportTicketModel.deleteMany({ user: userId }),
    PredictionMatchModel.updateMany({ _id: { $in: predictionMatches } }, { $inc: { predictionsCount: -1 } }),
    user.referredBy ? UserModel.updateOne({ _id: user.referredBy }, { $inc: { referralsCount: -1 } }) : null,
    UserModel.updateMany({ referredBy: userId }, { $unset: { referredBy: 1 } }),
  ])
  await user.deleteOne()
  res.json({ ok: true })
}

import { Types, type PipelineStage } from "mongoose"
import { startOfPeriod, type Period } from "../../utils/dates.js"
import { TransactionModel } from "../points/transaction.model.js"
import { UserModel } from "../users/user.model.js"
import { globalRank } from "../users/user.service.js"

export type LeaderboardPeriod = Period | "all"

export interface LeaderboardQuery {
  period: LeaderboardPeriod
  country?: string
  page: number
  limit: number
}

interface RankedUser {
  _id: Types.ObjectId
  firstName: string
  lastName?: string
  username: string
  country: string
  city?: string
  level: number
  status?: string
}

const toEntry = (user: RankedUser, rank: number, points: number) => ({
  rank,
  userId: String(user._id),
  name: [user.firstName, user.lastName].filter(Boolean).join(" "),
  username: user.username,
  initials: `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? user.firstName?.[1] ?? ""}`.toUpperCase(),
  country: user.country,
  city: user.city || undefined,
  level: user.level,
  points,
})

export type LeaderboardEntry = ReturnType<typeof toEntry>

// Sum of each user's ledger since the start of the period ("spent" excluded).
const periodPipeline = (period: Period, country?: string): PipelineStage[] => [
  { $match: { createdAt: { $gte: startOfPeriod(period) }, type: { $ne: "spent" } } },
  { $group: { _id: "$user", points: { $sum: "$points" }, lastAt: { $max: "$createdAt" } } },
  { $match: { points: { $gt: 0 } } },
  { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
  { $unwind: "$user" },
  { $match: { "user.status": "active", ...(country ? { "user.country": country } : {}) } },
]

export async function getLeaderboard({ period, country, page, limit }: LeaderboardQuery) {
  const skip = (page - 1) * limit

  if (period === "all") {
    const filter = { status: "active" as const, xp: { $gt: 0 }, ...(country ? { country } : {}) }
    const [users, total] = await Promise.all([
      UserModel.find(filter).sort({ xp: -1, createdAt: 1 }).skip(skip).limit(limit).lean(),
      UserModel.countDocuments(filter),
    ])
    return { items: users.map((u, i) => toEntry(u as RankedUser, skip + i + 1, u.xp)), total }
  }

  const [result] = await TransactionModel.aggregate<{
    items: Array<{ points: number; user: RankedUser }>
    total: Array<{ n: number }>
  }>([
    ...periodPipeline(period, country),
    // Ties go to whoever reached the score first.
    { $sort: { points: -1, lastAt: 1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }, { $project: { points: 1, user: 1 } }],
        total: [{ $count: "n" }],
      },
    },
  ])

  return {
    items: result.items.map((row, i) => toEntry(row.user, skip + i + 1, row.points)),
    total: result.total[0]?.n ?? 0,
  }
}

/** Rank and points of one user for a period (rank null when no points yet). */
export async function getUserPosition(
  userId: Types.ObjectId | string,
  period: LeaderboardPeriod,
  country?: string,
): Promise<{ rank: number | null; points: number }> {
  if (period === "all") {
    const user = await UserModel.findById(userId).lean()
    if (!user || user.xp <= 0) return { rank: null, points: user?.xp ?? 0 }
    if (!country) return { rank: await globalRank(user), points: user.xp }
    const ahead = await UserModel.countDocuments({
      status: "active",
      country,
      $or: [{ xp: { $gt: user.xp } }, { xp: user.xp, createdAt: { $lt: user.createdAt } }],
    })
    return { rank: ahead + 1, points: user.xp }
  }

  const [mine] = await TransactionModel.aggregate<{ points: number }>([
    {
      $match: {
        user: new Types.ObjectId(String(userId)),
        createdAt: { $gte: startOfPeriod(period) },
        type: { $ne: "spent" },
      },
    },
    { $group: { _id: null, points: { $sum: "$points" } } },
  ])
  const points = mine?.points ?? 0
  if (points <= 0) return { rank: null, points }

  const [ahead] = await TransactionModel.aggregate<{ n: number }>([
    ...periodPipeline(period, country),
    { $match: { points: { $gt: points } } },
    { $count: "n" },
  ])
  return { rank: (ahead?.n ?? 0) + 1, points }
}

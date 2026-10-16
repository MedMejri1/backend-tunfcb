import type { RequestHandler } from "express"
import { Types } from "mongoose"
import { z } from "zod"
import { paginated, paginationSchema } from "../../utils/pagination.js"
import { TRANSACTION_TYPES, TransactionModel } from "./transaction.model.js"

const listSchema = paginationSchema.extend({
  user: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

/** Full points ledger with filters, plus totals per type for the same filter. */
export const listTransactions: RequestHandler = async (req, res) => {
  const q = listSchema.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (q.user) filter.user = new Types.ObjectId(q.user)
  if (q.type) filter.type = q.type
  if (q.from || q.to) {
    filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) }
  }

  const [items, total, totals] = await Promise.all([
    TransactionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate<{ user: { _id: Types.ObjectId; firstName: string; lastName?: string; username: string } | null }>(
        "user",
        "firstName lastName username",
      )
      .populate<{ createdBy: { name: string } | null }>("createdBy", "name")
      .lean(),
    TransactionModel.countDocuments(filter),
    TransactionModel.aggregate<{ _id: string; points: number; count: number }>([
      { $match: filter },
      { $group: { _id: "$type", points: { $sum: "$points" }, count: { $sum: 1 } } },
    ]),
  ])

  res.json({
    ...paginated(
      items.map((t) => ({
        id: String(t._id),
        type: t.type,
        title: t.title,
        detail: t.detail,
        points: t.points,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt,
        createdBy: t.createdBy?.name,
        user: t.user
          ? {
              id: String(t.user._id),
              name: [t.user.firstName, t.user.lastName].filter(Boolean).join(" "),
              username: t.user.username,
            }
          : null,
      })),
      total,
      q.page,
      q.limit,
    ),
    totals: totals.map((t) => ({ type: t._id, points: t.points, count: t.count })),
  })
}

import type { RequestHandler } from "express"
import { z } from "zod"
import { paginated } from "../../utils/pagination.js"
import { getLeaderboard, getUserPosition } from "./leaderboard.service.js"

const querySchema = z.object({
  period: z.enum(["day", "week", "month", "year", "all"]).default("week"),
  scope: z.enum(["global", "national"]).default("global"),
  country: z.string().trim().length(2).toUpperCase().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** Mobile: leaderboard + the caller's own position. */
export const appLeaderboard: RequestHandler = async (req, res) => {
  const q = querySchema.parse(req.query)
  // Guests (no account) see the board without a position of their own.
  const user = req.appUser
  const country = q.scope === "national" ? (user?.country ?? "TN") : undefined
  const [board, me] = await Promise.all([
    getLeaderboard({ period: q.period, country, page: q.page, limit: q.limit }),
    user ? getUserPosition(user._id, q.period, country) : null,
  ])
  res.json({
    ...paginated(
      board.items.map((e) => ({ ...e, isCurrentUser: !!user && e.userId === user.id })),
      board.total,
      q.page,
      q.limit,
    ),
    me,
  })
}

/** Dashboard: any period, optional country filter. */
export const adminLeaderboard: RequestHandler = async (req, res) => {
  const q = querySchema.parse(req.query)
  const board = await getLeaderboard({ period: q.period, country: q.country, page: q.page, limit: q.limit })
  res.json(paginated(board.items, board.total, q.page, q.limit))
}

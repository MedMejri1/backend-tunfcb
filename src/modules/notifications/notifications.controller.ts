import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { paginated, paginationSchema } from "../../utils/pagination.js"
import { UserModel } from "../users/user.model.js"
import { pushToUsers } from "../push/push.service.js"
import { NOTIFICATION_CATEGORIES, NotificationModel } from "./notification.model.js"

/** Mobile: broadcasts + personal notifications, newest first. */
export const myNotifications: RequestHandler = async (req, res) => {
  const user = req.appUser!
  const { page, limit } = paginationSchema.parse(req.query)
  // Users only see broadcasts sent after they joined.
  const filter = {
    $or: [{ user: user._id }, { user: { $exists: false }, createdAt: { $gte: user.createdAt } }],
  }
  const readAt = user.lastNotificationsReadAt?.getTime() ?? 0

  const [items, total, unread] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ ...filter, createdAt: { $gt: new Date(readAt) } }),
  ])

  res.json({
    ...paginated(
      items.map((n) => ({
        id: String(n._id),
        category: n.category,
        title: n.title,
        message: n.message,
        ref: n.ref,
        createdAt: n.createdAt,
        read: n.createdAt.getTime() <= readAt,
      })),
      total,
      page,
      limit,
    ),
    unread,
  })
}

export const markAllRead: RequestHandler = async (req, res) => {
  await UserModel.updateOne({ _id: req.appUser!._id }, { lastNotificationsReadAt: new Date() })
  res.json({ ok: true })
}

const createSchema = z.object({
  title: z.string().trim().min(2).max(120),
  message: z.string().trim().min(2).max(1000),
  category: z.enum(NOTIFICATION_CATEGORIES).default("system"),
  userId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  // Also show it as a phone notification (not only in the app's list).
  push: z.boolean().default(true),
})

export const adminListNotifications: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const audience = z.enum(["all", "broadcast", "personal"]).default("all").parse(req.query.audience)
  const filter =
    audience === "broadcast"
      ? { user: { $exists: false } }
      : audience === "personal"
        ? { user: { $exists: true } }
        : {}
  const [items, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate<{ user: { firstName: string; lastName?: string; username: string } | null }>(
        "user",
        "firstName lastName username",
      )
      .populate<{ createdBy: { name: string } | null }>("createdBy", "name")
      .lean(),
    NotificationModel.countDocuments(filter),
  ])
  res.json(
    paginated(
      items.map((n) => ({
        id: String(n._id),
        title: n.title,
        message: n.message,
        category: n.category,
        createdAt: n.createdAt,
        createdBy: n.createdBy?.name ?? null,
        user: n.user ? { name: [n.user.firstName, n.user.lastName].filter(Boolean).join(" "), username: n.user.username } : null,
      })),
      total,
      page,
      limit,
    ),
  )
}

export const adminCreateNotification: RequestHandler = async (req, res) => {
  const { userId, push, ...input } = createSchema.parse(req.body)
  if (userId && !(await UserModel.exists({ _id: userId }))) throw new HttpError(404, "Utilisateur introuvable")
  const notification = await NotificationModel.create({ ...input, user: userId, createdBy: req.admin!._id })
  const pushed = push
    ? await pushToUsers({ userIds: userId ? [userId] : undefined }, () => ({
        channel: "announcements",
        title: input.title,
        body: input.message,
        data: { type: "notification", id: String(notification._id) },
      }))
    : 0
  res.status(201).json({ id: String(notification._id), pushed })
}

export const adminDeleteNotification: RequestHandler = async (req, res) => {
  const deleted = await NotificationModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Notification introuvable")
  res.json({ ok: true })
}

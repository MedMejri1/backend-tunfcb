import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { escapeRegex, paginated, paginationSchema } from "../../utils/pagination.js"
import { AdminModel } from "../admins/admin.model.js"
import { OrderModel } from "../shop/order.model.js"
import { UserModel } from "../users/user.model.js"
import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, SupportTicketModel } from "./support.model.js"
import {
  createTicket,
  presentMessages,
  presentTicketSummary,
  replyAsAdmin,
  replyAsUser,
  setTicketStatus,
} from "./support.service.js"

const bodySchema = z.string().trim().min(2, "Message trop court").max(2000, "2000 caractères maximum")

// ------------------------------------------------------------ Mobile

export const myTickets: RequestHandler = async (req, res) => {
  const tickets = await SupportTicketModel.find({ user: req.appUser!._id }).sort({ lastMessageAt: -1 }).limit(50).lean()
  res.json({ items: tickets.map((t) => presentTicketSummary(t, "user")) })
}

const createSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(3, "Indique un sujet").max(120),
  message: bodySchema,
  orderId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
})

export const createMyTicket: RequestHandler = async (req, res) => {
  const ticket = await createTicket(req.appUser!._id, createSchema.parse(req.body))
  res.status(201).json({ ticket: presentTicketSummary(ticket.toObject(), "user") })
}

export const myTicket: RequestHandler = async (req, res) => {
  // Opening the conversation marks the team's replies as read.
  const ticket = await SupportTicketModel.findOneAndUpdate(
    { _id: req.params.id, user: req.appUser!._id },
    { userUnread: false },
    { returnDocument: "after" },
  ).lean()
  if (!ticket) throw new HttpError(404, "Demande introuvable")
  const order = ticket.order ? await OrderModel.findById(ticket.order).select("number").lean() : null
  res.json({
    ticket: {
      ...presentTicketSummary(ticket, "user"),
      order: order ? { id: String(order._id), number: order.number } : null,
      messages: presentMessages(ticket),
    },
  })
}

export const replyToMyTicket: RequestHandler = async (req, res) => {
  const ticket = await replyAsUser(req.appUser!._id, String(req.params.id), bodySchema.parse(req.body.body))
  res.json({ ticket: { ...presentTicketSummary(ticket.toObject(), "user"), messages: presentMessages(ticket.toObject()) } })
}

// ------------------------------------------------------------ Admin

export const adminListTickets: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const { status, search } = z
    .object({ status: z.enum(SUPPORT_STATUSES).optional(), search: z.string().trim().optional() })
    .parse(req.query)

  // Search by request number, subject, or the supporter's name / email.
  const rx = search ? { $regex: escapeRegex(search), $options: "i" } : null
  // Every word must match (so "Mohamed Mejri" finds first + last name).
  const words = (search ?? "").split(/\s+/).filter(Boolean).map((w) => ({ $regex: escapeRegex(w), $options: "i" }))
  const userIds = words.length
    ? await UserModel.find({
        $and: words.map((w) => ({ $or: [{ firstName: w }, { lastName: w }, { email: w }, { username: w }] })),
      }).distinct("_id")
    : []
  const filter = {
    ...(status ? { status } : {}),
    ...(rx ? { $or: [{ number: rx }, { subject: rx }, { user: { $in: userIds } }] } : {}),
  }

  const [items, total, counts] = await Promise.all([
    SupportTicketModel.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate<{ user: { _id: unknown; firstName: string; lastName: string; email: string } | null }>(
        "user",
        "firstName lastName email",
      )
      .lean(),
    SupportTicketModel.countDocuments(filter),
    SupportTicketModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ])

  res.json({
    ...paginated(
      items.map((t) => ({
        ...presentTicketSummary(t, "admin"),
        user: t.user ? { id: String(t.user._id), name: `${t.user.firstName} ${t.user.lastName}`.trim(), email: t.user.email } : null,
      })),
      total,
      page,
      limit,
    ),
    counts: Object.fromEntries(SUPPORT_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.count ?? 0])),
  })
}

export const adminTicket: RequestHandler = async (req, res) => {
  const ticket = await SupportTicketModel.findByIdAndUpdate(req.params.id, { adminUnread: false }, { returnDocument: "after" }).lean()
  if (!ticket) throw new HttpError(404, "Demande introuvable")

  const adminIds = ticket.messages.flatMap((m) => (m.admin ? [m.admin] : []))
  const [user, order, admins, userTickets] = await Promise.all([
    UserModel.findById(ticket.user).select("firstName lastName email username createdAt").lean(),
    ticket.order ? OrderModel.findById(ticket.order).select("number status total").lean() : null,
    AdminModel.find({ _id: { $in: adminIds } }).select("name").lean(),
    SupportTicketModel.countDocuments({ user: ticket.user }),
  ])

  res.json({
    ticket: {
      ...presentTicketSummary(ticket, "admin"),
      messages: presentMessages(ticket, new Map(admins.map((a) => [String(a._id), a.name]))),
      order: order ? { id: String(order._id), number: order.number, status: order.status, total: order.total } : null,
      user: user
        ? {
            id: String(user._id),
            name: `${user.firstName} ${user.lastName}`.trim(),
            email: user.email,
            username: user.username,
            memberSince: user.createdAt,
            ticketsCount: userTickets,
          }
        : null,
    },
  })
}

export const adminReply: RequestHandler = async (req, res) => {
  await replyAsAdmin(req.admin!._id, String(req.params.id), bodySchema.parse(req.body.body))
  res.json({ ok: true })
}

export const adminSetStatus: RequestHandler = async (req, res) => {
  const { status } = z.object({ status: z.enum(["open", "closed"]) }).parse(req.body)
  await setTicketStatus(String(req.params.id), status)
  res.json({ ok: true })
}

/** Sidebar badge: requests waiting for an answer. */
export const adminSupportSummary: RequestHandler = async (_req, res) => {
  const [awaiting, unread] = await Promise.all([
    SupportTicketModel.countDocuments({ status: "open" }),
    SupportTicketModel.countDocuments({ adminUnread: true }),
  ])
  res.json({ awaiting, unread })
}

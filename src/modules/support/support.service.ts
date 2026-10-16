import type { Types } from "mongoose"
import { HttpError } from "../../middlewares/errorHandler.js"
import { nextSequence } from "../../utils/sequence.js"
import { NotificationModel } from "../notifications/notification.model.js"
import { OrderModel } from "../shop/order.model.js"
import { SupportTicketModel, type SupportCategory, type SupportTicket } from "./support.model.js"

type TicketDoc = SupportTicket & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }
type TicketSummarySource = Pick<
  TicketDoc,
  "_id" | "number" | "category" | "subject" | "status" | "createdAt" | "lastMessageAt" | "messages" | "userUnread" | "adminUnread"
>

// Anti-spam: new requests per supporter per 24 h.
const MAX_NEW_PER_DAY = 5

export const presentTicketSummary = (t: TicketSummarySource, side: "user" | "admin") => {
  const last = t.messages[t.messages.length - 1]
  return {
    id: String(t._id),
    number: t.number,
    category: t.category,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt,
    lastMessageAt: t.lastMessageAt,
    lastMessage: last ? { from: last.from, body: last.body.slice(0, 140) } : null,
    messagesCount: t.messages.length,
    unread: side === "user" ? t.userUnread : t.adminUnread,
  }
}

export const presentMessages = (t: Pick<TicketDoc, "messages">, adminNames: Map<string, string> = new Map()) =>
  t.messages.map((m) => ({
    from: m.from,
    body: m.body,
    at: m.at,
    ...(m.admin ? { adminName: adminNames.get(String(m.admin)) } : {}),
  }))

export async function createTicket(
  userId: Types.ObjectId,
  input: { category: SupportCategory; subject: string; message: string; orderId?: string },
) {
  const recent = await SupportTicketModel.countDocuments({
    user: userId,
    createdAt: { $gte: new Date(Date.now() - 86_400_000) },
  })
  if (recent >= MAX_NEW_PER_DAY) {
    throw new HttpError(429, "Tu as déjà envoyé plusieurs demandes aujourd'hui, réponds plutôt dans une demande existante")
  }
  if (input.orderId && !(await OrderModel.exists({ _id: input.orderId, user: userId }))) {
    throw new HttpError(400, "Commande introuvable")
  }

  const now = new Date()
  return SupportTicketModel.create({
    number: await nextSequence("support", "SUP"),
    user: userId,
    category: input.category,
    subject: input.subject,
    order: input.orderId,
    status: "open",
    messages: [{ from: "user", body: input.message, at: now }],
    lastMessageAt: now,
    adminUnread: true,
  })
}

/** A message from the supporter (re)opens the request for the team. */
export async function replyAsUser(userId: Types.ObjectId, ticketId: string, body: string) {
  const now = new Date()
  const ticket = await SupportTicketModel.findOneAndUpdate(
    { _id: ticketId, user: userId },
    {
      status: "open",
      lastMessageAt: now,
      adminUnread: true,
      userUnread: false,
      $push: { messages: { from: "user", body, at: now } },
    },
    { returnDocument: "after" },
  )
  if (!ticket) throw new HttpError(404, "Demande introuvable")
  return ticket
}

export async function replyAsAdmin(adminId: Types.ObjectId, ticketId: string, body: string) {
  const now = new Date()
  const ticket = await SupportTicketModel.findByIdAndUpdate(
    ticketId,
    {
      status: "answered",
      lastMessageAt: now,
      adminUnread: false,
      userUnread: true,
      $push: { messages: { from: "admin", body, at: now, admin: adminId } },
    },
    { returnDocument: "after" },
  )
  if (!ticket) throw new HttpError(404, "Demande introuvable")

  await NotificationModel.create({
    user: ticket.user,
    category: "support",
    title: "Nouvelle réponse de l'équipe Tunfcb",
    message: `${ticket.number} · ${ticket.subject} : ${body.slice(0, 160)}`,
    ref: String(ticket._id),
  })
  return ticket
}

export async function setTicketStatus(ticketId: string, status: "open" | "closed") {
  const ticket = await SupportTicketModel.findByIdAndUpdate(ticketId, { status }, { returnDocument: "after" })
  if (!ticket) throw new HttpError(404, "Demande introuvable")
  return ticket
}

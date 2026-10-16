import type { Types } from "mongoose"
import { HttpError } from "../../middlewares/errorHandler.js"
import { NotificationModel } from "../notifications/notification.model.js"
import { getSettings } from "../settings/settings.service.js"
import { OrderModel, nextOrderNumber, type Order } from "./order.model.js"
import { ProductModel, type Product } from "./product.model.js"
import {
  OPEN_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  type OrderStatus,
} from "./shop.constants.js"

type WithId<T> = T & { _id: Types.ObjectId }

export const formatDt = (millimes: number) =>
  `${(millimes / 1000).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })} DT`

// ------------------------------------------------------------ Presenters

export const presentProduct = (p: WithId<Product>) => ({
  id: String(p._id),
  name: p.name,
  description: p.description,
  category: p.category,
  price: p.price,
  images: p.images,
  sizes: p.sizes,
  stock: p.stock ?? null,
  available: p.status === "published" && (p.stock == null || p.stock > 0),
  featured: p.featured,
})

/** Order as the buyer sees it (no internal note). */
export const presentOrder = (o: WithId<Order> & { createdAt: Date; updatedAt: Date }) => ({
  id: String(o._id),
  number: o.number,
  status: o.status,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
  items: o.items.map((i) => ({
    productId: String(i.product),
    name: i.name,
    image: i.image,
    size: i.size,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    lineTotal: i.lineTotal,
  })),
  subtotal: o.subtotal,
  shippingFee: o.shippingFee,
  total: o.total,
  paymentMethod: o.paymentMethod,
  shipping: o.shipping,
  history: o.history.map((h) => ({ status: h.status, at: h.at, note: h.note })),
  tracking: o.tracking ?? {},
  cancelReason: o.cancelReason,
  canCancel: o.status === "pending",
})

// ------------------------------------------------------------ Stock

interface StockLine {
  product: Types.ObjectId
  quantity: number
}

/** Puts the items of a cancelled order back in stock. */
async function releaseStock(items: StockLine[]) {
  await Promise.all(
    items.map((i) =>
      ProductModel.updateOne({ _id: i.product, stock: { $ne: null } }, { $inc: { stock: i.quantity, sold: -i.quantity } }),
    ),
  )
  // Products with unlimited stock only track sales.
  await Promise.all(
    items.map((i) => ProductModel.updateOne({ _id: i.product, stock: null }, { $inc: { sold: -i.quantity } })),
  )
}

/**
 * Reserves stock line by line; if one line fails, what was already reserved
 * is released so concurrent orders can never oversell.
 */
async function reserveStock(lines: Array<StockLine & { name: string; unlimited: boolean }>) {
  const reserved: StockLine[] = []
  for (const line of lines) {
    const ok = line.unlimited
      ? await ProductModel.updateOne({ _id: line.product }, { $inc: { sold: line.quantity } })
      : await ProductModel.updateOne(
          { _id: line.product, stock: { $gte: line.quantity } },
          { $inc: { stock: -line.quantity, sold: line.quantity } },
        )
    if (ok.modifiedCount === 0) {
      await releaseStock(reserved)
      throw new HttpError(409, `Stock insuffisant pour « ${line.name} »`)
    }
    reserved.push(line)
  }
}

// ------------------------------------------------------------ Orders

export interface OrderInput {
  items: Array<{ productId: string; size?: string; quantity: number }>
  shipping: { fullName: string; phone: string; governorate: string; city: string; address: string; note?: string }
}

async function notifyUser(userId: Types.ObjectId, orderId: Types.ObjectId, title: string, message: string) {
  await NotificationModel.create({ user: userId, category: "order", title, message, ref: String(orderId) })
}

export async function createOrder(userId: Types.ObjectId, input: OrderInput) {
  const { shop } = await getSettings()
  if (!shop.enabled) throw new HttpError(403, "La boutique n'est pas encore ouverte")

  const ids = [...new Set(input.items.map((i) => i.productId))]
  const products = await ProductModel.find({ _id: { $in: ids }, status: "published" }).lean()

  // Same product + size twice in the cart = one line.
  const merged = new Map<string, { productId: string; size?: string; quantity: number }>()
  for (const item of input.items) {
    const key = `${item.productId}|${item.size ?? ""}`
    const existing = merged.get(key)
    merged.set(key, { ...item, quantity: (existing?.quantity ?? 0) + item.quantity })
  }

  const items = [...merged.values()].map((item) => {
    const product = products.find((p) => String(p._id) === item.productId)
    if (!product) throw new HttpError(409, "Un article de ton panier n'est plus disponible")
    if (product.sizes.length && (!item.size || !product.sizes.includes(item.size))) {
      throw new HttpError(400, `Choisis une taille pour « ${product.name} »`)
    }
    if (item.quantity > shop.maxQuantityPerItem) {
      throw new HttpError(400, `${shop.maxQuantityPerItem} exemplaires maximum par article`)
    }
    return {
      product: product._id,
      name: product.name,
      image: product.images[0],
      size: product.sizes.length ? item.size : undefined,
      unitPrice: product.price,
      quantity: item.quantity,
      lineTotal: product.price * item.quantity,
      unlimited: product.stock == null,
    }
  })

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0)
  const freeShipping = shop.freeShippingFrom > 0 && subtotal >= shop.freeShippingFrom
  const shippingFee = freeShipping ? 0 : shop.shippingFee

  await reserveStock(items)

  let order
  try {
    order = await OrderModel.create({
      number: await nextOrderNumber(),
      user: userId,
      items: items.map(({ unlimited: _unlimited, ...item }) => item),
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      shipping: input.shipping,
      status: "pending",
      history: [{ status: "pending", at: new Date(), by: "user" }],
    })
  } catch (err) {
    await releaseStock(items)
    throw err
  }

  await notifyUser(
    userId,
    order._id,
    `Commande ${order.number} reçue`,
    `Merci ! Ta commande de ${formatDt(order.total)} a bien été enregistrée. Nous te contacterons pour la confirmer.`,
  )
  return order
}

export async function cancelOrderByUser(userId: Types.ObjectId, orderId: string) {
  const order = await OrderModel.findOneAndUpdate(
    { _id: orderId, user: userId, status: "pending" },
    {
      status: "cancelled",
      cancelReason: "Annulée par le client",
      $push: { history: { status: "cancelled", at: new Date(), by: "user", note: "Annulée par le client" } },
    },
    { returnDocument: "after" },
  )
  if (!order) throw new HttpError(409, "Cette commande ne peut plus être annulée")
  await releaseStock(order.items)
  return order
}

const STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  confirmed: "Ta commande est confirmée, nous la préparons bientôt.",
  preparing: "Ta commande est en cours de préparation.",
  shipped: "Ta commande est en route ! Paiement à la livraison.",
  delivered: "Ta commande a été livrée. Merci et Visca el Barça !",
}

export async function changeOrderStatus(
  orderId: string,
  adminId: Types.ObjectId,
  next: OrderStatus,
  options: { note?: string; tracking?: { carrier?: string; trackingNumber?: string; trackingUrl?: string } } = {},
) {
  const current = await OrderModel.findById(orderId)
  if (!current) throw new HttpError(404, "Commande introuvable")
  if (!ORDER_TRANSITIONS[current.status].includes(next)) {
    throw new HttpError(409, `Impossible de passer de « ${ORDER_STATUS_LABELS[current.status]} » à « ${ORDER_STATUS_LABELS[next]} »`)
  }

  // Conditional update: two admins clicking at once can't apply the change twice.
  const order = await OrderModel.findOneAndUpdate(
    { _id: orderId, status: current.status },
    {
      status: next,
      ...(next === "cancelled" ? { cancelReason: options.note || "Annulée par la boutique" } : {}),
      ...(options.tracking ? { tracking: { ...current.tracking, ...options.tracking } } : {}),
      $push: { history: { status: next, at: new Date(), by: "admin", admin: adminId, note: options.note } },
    },
    { returnDocument: "after" },
  )
  if (!order) throw new HttpError(409, "La commande a été modifiée entre-temps, recharge la page")

  if (next === "cancelled" && OPEN_ORDER_STATUSES.includes(current.status)) await releaseStock(order.items)

  await notifyUser(
    order.user,
    order._id,
    `Commande ${order.number} ${ORDER_STATUS_LABELS[next]}`,
    next === "cancelled"
      ? `Ta commande a été annulée${options.note ? ` : ${options.note}` : "."}`
      : (STATUS_MESSAGES[next] ?? ""),
  )
  return order
}

/** Account deletion: open orders give their stock back, then all orders are removed. */
export async function deleteOrdersOfUser(userId: Types.ObjectId) {
  const open = await OrderModel.find({ user: userId, status: { $in: OPEN_ORDER_STATUSES } }).lean()
  for (const order of open) await releaseStock(order.items)
  await OrderModel.deleteMany({ user: userId })
}

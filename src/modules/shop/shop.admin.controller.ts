import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { RequestHandler } from "express"
import { z } from "zod"
import { env } from "../../config/env.js"
import { HttpError } from "../../middlewares/errorHandler.js"
import { escapeRegex, paginated, paginationSchema } from "../../utils/pagination.js"
import { AdminModel } from "../admins/admin.model.js"
import { getSettings, updateSettings } from "../settings/settings.service.js"
import { UserModel } from "../users/user.model.js"
import { settingsSchema } from "../settings/settings.schemas.js"
import { OrderModel } from "./order.model.js"
import { ProductModel } from "./product.model.js"
import { ORDER_STATUSES, ORDER_TRANSITIONS, PRODUCT_CATEGORIES, PRODUCT_STATUSES } from "./shop.constants.js"
import { changeOrderStatus, presentOrder } from "./shop.service.js"

// ------------------------------------------------------------ Products

const productSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(120),
  description: z.string().trim().max(4000).default(""),
  category: z.enum(PRODUCT_CATEGORIES),
  price: z.number().int("Prix invalide").min(0),
  images: z.array(z.string().trim().min(1).max(500)).max(8, "8 photos maximum").default([]),
  sizes: z.array(z.string().trim().min(1).max(20)).max(12).default([]),
  stock: z.number().int().min(0).nullable().default(null),
  featured: z.boolean().default(false),
  status: z.enum(PRODUCT_STATUSES).default("draft"),
})

const presentAdminProduct = (p: Record<string, unknown> & { _id: unknown }) => {
  const { _id, __v: _v, ...rest } = p
  return { id: String(_id), ...rest }
}

export const listProducts: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const { search, category, status } = z
    .object({
      search: z.string().trim().optional(),
      category: z.enum(PRODUCT_CATEGORIES).optional(),
      status: z.enum(PRODUCT_STATUSES).optional(),
    })
    .parse(req.query)

  const filter = {
    ...(search ? { name: { $regex: escapeRegex(search), $options: "i" } } : {}),
    ...(category ? { category } : {}),
    // Archived products are hidden unless asked for.
    ...(status ? { status } : { status: { $ne: "archived" as const } }),
  }
  const [items, total, counts] = await Promise.all([
    ProductModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ProductModel.countDocuments(filter),
    ProductModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ])
  res.json({
    ...paginated(items.map(presentAdminProduct), total, page, limit),
    counts: Object.fromEntries(PRODUCT_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.count ?? 0])),
  })
}

export const createProduct: RequestHandler = async (req, res) => {
  const input = productSchema.parse(req.body)
  const product = await ProductModel.create({
    ...input,
    publishedAt: input.status === "published" ? new Date() : undefined,
  })
  res.status(201).json({ product: presentAdminProduct(product.toObject()) })
}

export const updateProduct: RequestHandler = async (req, res) => {
  const input = productSchema.partial().parse(req.body)
  const current = await ProductModel.findById(req.params.id)
  if (!current) throw new HttpError(404, "Article introuvable")
  current.set(input)
  if (input.status === "published" && !current.publishedAt) current.publishedAt = new Date()
  await current.save()
  res.json({ product: presentAdminProduct(current.toObject()) })
}

export const deleteProduct: RequestHandler = async (req, res) => {
  // Already ordered: keep it for the order history, just take it off the shop.
  if (await OrderModel.exists({ "items.product": req.params.id })) {
    await ProductModel.updateOne({ _id: req.params.id }, { status: "archived" })
    res.json({ ok: true, archived: true })
    return
  }
  const deleted = await ProductModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Article introuvable")
  res.json({ ok: true, archived: false })
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

/** Raw image body (Content-Type: image/*), stored on disk and served under /api/uploads. */
export const uploadProductImage: RequestHandler = async (req, res) => {
  const ext = IMAGE_TYPES[(req.headers["content-type"] ?? "").split(";")[0]]
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new HttpError(400, "Image JPG, PNG ou WebP attendue (5 Mo maximum)")
  }
  const dir = path.resolve(env.UPLOAD_DIR, "products")
  await mkdir(dir, { recursive: true })
  const name = `${randomUUID()}.${ext}`
  await writeFile(path.join(dir, name), req.body)
  res.status(201).json({ url: `/api/uploads/products/${name}` })
}

// ------------------------------------------------------------ Orders

export const listOrders: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const { search, status } = z
    .object({ search: z.string().trim().optional(), status: z.enum(ORDER_STATUSES).optional() })
    .parse(req.query)

  const rx = search ? { $regex: escapeRegex(search), $options: "i" } : null
  const filter = {
    ...(status ? { status } : {}),
    ...(rx ? { $or: [{ number: rx }, { "shipping.fullName": rx }, { "shipping.phone": rx }] } : {}),
  }
  const [items, total] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate<{ user: { _id: unknown; firstName: string; lastName: string; email: string } | null }>(
        "user",
        "firstName lastName email",
      )
      .lean(),
    OrderModel.countDocuments(filter),
  ])
  res.json(
    paginated(
      items.map((o) => ({
        id: String(o._id),
        number: o.number,
        status: o.status,
        createdAt: o.createdAt,
        total: o.total,
        itemsCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        customer: { name: o.shipping?.fullName ?? "", phone: o.shipping?.phone ?? "", governorate: o.shipping?.governorate ?? "" },
        user: o.user
          ? { id: String(o.user._id), name: `${o.user.firstName} ${o.user.lastName}`.trim(), email: o.user.email }
          : null,
      })),
      total,
      page,
      limit,
    ),
  )
}

export const getOrder: RequestHandler = async (req, res) => {
  const order = await OrderModel.findById(req.params.id).lean()
  if (!order) throw new HttpError(404, "Commande introuvable")

  const adminIds = order.history.flatMap((h) => (h.admin ? [h.admin] : []))
  const [user, admins] = await Promise.all([
    UserModel.findById(order.user).select("firstName lastName email username").lean(),
    AdminModel.find({ _id: { $in: adminIds } }).select("name").lean(),
  ])

  res.json({
    order: {
      ...presentOrder(order),
      history: order.history.map((h) => ({
        status: h.status,
        at: h.at,
        note: h.note,
        by: h.by,
        adminName: h.admin ? admins.find((a) => a._id.equals(h.admin))?.name : undefined,
      })),
      adminNote: order.adminNote ?? "",
      nextStatuses: ORDER_TRANSITIONS[order.status],
      user: user
        ? { id: String(user._id), name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, username: user.username }
        : null,
    },
  })
}

const trackingSchema = z.object({
  carrier: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().max(80).optional(),
  trackingUrl: z.url("Lien de suivi invalide").max(500).optional().or(z.literal("")),
})

export const updateOrderStatus: RequestHandler = async (req, res) => {
  const { status, note, tracking } = z
    .object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(300).optional(), tracking: trackingSchema.optional() })
    .parse(req.body)
  await changeOrderStatus(String(req.params.id), req.admin!._id, status, { note: note || undefined, tracking })
  res.json({ ok: true })
}

export const updateOrder: RequestHandler = async (req, res) => {
  const input = z
    .object({ tracking: trackingSchema.optional(), adminNote: z.string().trim().max(2000).optional() })
    .parse(req.body)
  const order = await OrderModel.findById(req.params.id)
  if (!order) throw new HttpError(404, "Commande introuvable")
  if (input.tracking) order.tracking = { ...order.tracking, ...input.tracking }
  if (input.adminNote !== undefined) order.adminNote = input.adminNote
  await order.save()
  res.json({ ok: true })
}

/** Header figures of the shop pages. */
export const shopSummary: RequestHandler = async (_req, res) => {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [byStatus, revenue, monthOrders, published, lowStock, { shop }] = await Promise.all([
    OrderModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    OrderModel.aggregate<{ total: number }>([
      { $match: { status: "delivered" } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    OrderModel.countDocuments({ createdAt: { $gte: monthStart }, status: { $ne: "cancelled" } }),
    ProductModel.countDocuments({ status: "published" }),
    ProductModel.find({ status: "published", stock: { $ne: null, $lte: 3 } })
      .select("name stock")
      .sort({ stock: 1 })
      .limit(10)
      .lean(),
    getSettings(),
  ])
  res.json({
    shop,
    ordersByStatus: Object.fromEntries(ORDER_STATUSES.map((s) => [s, byStatus.find((b) => b._id === s)?.count ?? 0])),
    deliveredRevenue: revenue[0]?.total ?? 0,
    monthOrders,
    publishedProducts: published,
    lowStock: lowStock.map((p) => ({ id: String(p._id), name: p.name, stock: p.stock })),
  })
}

export const updateShopSettings: RequestHandler = async (req, res) => {
  const shop = settingsSchema.shape.shop.parse(req.body)
  const settings = await getSettings()
  const saved = await updateSettings({ ...settings, shop })
  res.json({ shop: saved.shop })
}

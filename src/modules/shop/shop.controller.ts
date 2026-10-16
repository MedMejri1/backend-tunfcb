import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { getSettings } from "../settings/settings.service.js"
import { OrderModel } from "./order.model.js"
import { ProductModel } from "./product.model.js"
import { GOVERNORATES, PRODUCT_CATEGORIES } from "./shop.constants.js"
import { cancelOrderByUser, createOrder, presentOrder, presentProduct } from "./shop.service.js"

/** Mobile: shop status and catalogue (published products are shown as a preview while closed). */
export const getShop: RequestHandler = async (_req, res) => {
  const { shop } = await getSettings()
  const products = await ProductModel.find({ status: "published" })
    .sort({ featured: -1, publishedAt: -1 })
    .limit(200)
    .lean()
  res.json({
    enabled: shop.enabled,
    shippingFee: shop.shippingFee,
    freeShippingFrom: shop.freeShippingFrom,
    maxQuantityPerItem: shop.maxQuantityPerItem,
    categories: PRODUCT_CATEGORIES,
    governorates: GOVERNORATES,
    products: products.map(presentProduct),
  })
}

export const getProduct: RequestHandler = async (req, res) => {
  const product = await ProductModel.findOne({ _id: req.params.id, status: "published" }).lean()
  if (!product) throw new HttpError(404, "Article introuvable")
  res.json({ product: presentProduct(product) })
}

// Tunisian numbers: 8 digits, optionally prefixed with +216 / 00216.
const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s.-]/g, "").replace(/^(\+|00)216/, ""))
  .pipe(z.string().regex(/^[2-9]\d{7}$/, "Numéro de téléphone tunisien invalide (8 chiffres)"))

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().regex(/^[a-f0-9]{24}$/i, "Article invalide"),
        size: z.string().trim().max(20).optional(),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1, "Ton panier est vide")
    .max(30),
  shipping: z.object({
    fullName: z.string().trim().min(3, "Indique ton nom complet").max(80),
    phone: phoneSchema,
    governorate: z.enum(GOVERNORATES, "Choisis ton gouvernorat"),
    city: z.string().trim().min(2, "Indique ta ville").max(60),
    address: z.string().trim().min(5, "Indique ton adresse").max(200),
    note: z.string().trim().max(300).optional(),
  }),
})

export const placeOrder: RequestHandler = async (req, res) => {
  const order = await createOrder(req.appUser!._id, orderSchema.parse(req.body))
  res.status(201).json({ order: presentOrder(order.toObject()) })
}

export const myOrders: RequestHandler = async (req, res) => {
  const orders = await OrderModel.find({ user: req.appUser!._id }).sort({ createdAt: -1 }).limit(100).lean()
  res.json({ items: orders.map(presentOrder) })
}

export const myOrder: RequestHandler = async (req, res) => {
  const order = await OrderModel.findOne({ _id: req.params.id, user: req.appUser!._id }).lean()
  if (!order) throw new HttpError(404, "Commande introuvable")
  res.json({ order: presentOrder(order) })
}

export const cancelMyOrder: RequestHandler = async (req, res) => {
  const order = await cancelOrderByUser(req.appUser!._id, String(req.params.id))
  res.json({ order: presentOrder(order.toObject()) })
}

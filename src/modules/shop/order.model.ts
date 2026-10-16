import { Schema, model, Types, type InferSchemaType } from "mongoose"
import { nextSequence } from "../../utils/sequence.js"
import { ORDER_STATUSES, PAYMENT_METHODS } from "./shop.constants.js"

// Amounts in millimes, copied at order time so later price edits don't change past orders.
const orderItemSchema = new Schema(
  {
    product: { type: Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    image: String,
    size: String,
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
)

const historySchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, required: true },
    note: String,
    by: { type: String, enum: ["user", "admin"], required: true },
    admin: { type: Types.ObjectId, ref: "Admin" },
  },
  { _id: false },
)

const orderSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    user: { type: Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    shippingFee: { type: Number, required: true },
    total: { type: Number, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "cash_on_delivery" },
    shipping: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      governorate: { type: String, required: true },
      city: { type: String, required: true },
      address: { type: String, required: true },
      note: String,
    },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    history: { type: [historySchema], default: [] },
    tracking: {
      carrier: String,
      trackingNumber: String,
      trackingUrl: String,
    },
    cancelReason: String,
    // Internal, never sent to the app.
    adminNote: String,
  },
  { timestamps: true },
)

orderSchema.index({ createdAt: -1 })

export type Order = InferSchemaType<typeof orderSchema>
export const OrderModel = model("Order", orderSchema)

export const nextOrderNumber = () => nextSequence("order", "TF")

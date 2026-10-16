import { Schema, model, type InferSchemaType } from "mongoose"
import { PRODUCT_CATEGORIES, PRODUCT_STATUSES } from "./shop.constants.js"

// Prices are stored in millimes (1 DT = 1000 millimes) to avoid float rounding.
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", trim: true, maxlength: 4000 },
    category: { type: String, enum: PRODUCT_CATEGORIES, required: true },
    price: { type: Number, required: true, min: 0 },
    images: { type: [String], default: [] },
    // Empty = one size; otherwise the buyer must pick one.
    sizes: { type: [String], default: [] },
    // null = unlimited stock.
    stock: { type: Number, default: null, min: 0 },
    sold: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },
    status: { type: String, enum: PRODUCT_STATUSES, default: "draft", index: true },
    publishedAt: Date,
  },
  { timestamps: true },
)

productSchema.index({ status: 1, featured: -1, publishedAt: -1 })

export type Product = InferSchemaType<typeof productSchema>
export const ProductModel = model("Product", productSchema)

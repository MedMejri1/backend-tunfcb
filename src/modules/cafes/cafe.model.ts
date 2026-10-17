import { Schema, model, Types, type InferSchemaType } from "mongoose"

// pending = sent from the app, waiting for the team to check it.
export const CAFE_STATUSES = ["pending", "approved", "rejected"] as const
export type CafeStatus = (typeof CAFE_STATUSES)[number]

export const CAFE_AMENITIES = ["big_screen", "terrace", "air_conditioning", "wifi", "family", "parking", "booking"] as const

// Cafés showing the Barça matches: listed for free in the app once the team has checked them.
const cafeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Codes from the municipality API, with their display names.
    governorate: { type: String, required: true },
    governorateName: { type: String, required: true },
    delegation: { type: String, required: true },
    delegationName: { type: String, required: true },
    address: { type: String, required: true, trim: true, maxlength: 160 },
    mapsUrl: { type: String, default: "", trim: true, maxlength: 500 },
    screens: { type: Number, default: null, min: 1, max: 50 },
    amenities: [{ type: String, enum: CAFE_AMENITIES }],
    description: { type: String, default: "", trim: true, maxlength: 300 },
    // The front of the café (one photo), so supporters recognise it.
    photo: { type: Types.ObjectId, ref: "CafePhoto", default: null },
    managerName: { type: String, required: true, trim: true, maxlength: 80 },
    // 8 digits. Shown in the app only if the manager agreed.
    phone: { type: String, required: true },
    showPhone: { type: Boolean, default: true },
    status: { type: String, enum: CAFE_STATUSES, default: "pending", index: true },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 300 },
    // Absent when sent in guest mode.
    submittedBy: { type: Types.ObjectId, ref: "User" },
    reviewedBy: { type: Types.ObjectId, ref: "Admin" },
    reviewedAt: Date,
  },
  { timestamps: true },
)

cafeSchema.index({ status: 1, governorate: 1, delegation: 1, name: 1 })

// Stored in MongoDB like the wall photos (Render's disk is wiped at each deploy),
// apart from the café so the lists don't load the bytes.
const cafePhotoSchema = new Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export type Cafe = InferSchemaType<typeof cafeSchema>
export const CafeModel = model("Cafe", cafeSchema)
export const CafePhotoModel = model("CafePhoto", cafePhotoSchema)

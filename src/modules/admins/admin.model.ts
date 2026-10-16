import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose"

const adminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["super_admin", "admin"], default: "admin" },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
)

export type Admin = InferSchemaType<typeof adminSchema>
export type AdminDocument = HydratedDocument<Admin>
export const AdminModel = model("Admin", adminSchema)

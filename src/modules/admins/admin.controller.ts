import type { RequestHandler } from "express"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { env } from "../../config/env.js"
import { HttpError } from "../../middlewares/errorHandler.js"
import { signAdminToken, type AdminRole } from "../../utils/jwt.js"
import { AdminModel, type AdminDocument } from "./admin.model.js"

const present = (admin: AdminDocument) => ({
  id: admin.id as string,
  name: admin.name,
  email: admin.email,
  role: admin.role,
  active: admin.active,
  lastLoginAt: admin.lastLoginAt,
  createdAt: admin.createdAt,
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

export const adminLogin: RequestHandler = async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)
  const admin = await AdminModel.findOne({ email }).select("+passwordHash")
  if (!admin || !admin.active || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw new HttpError(401, "Email ou mot de passe incorrect")
  }
  admin.lastLoginAt = new Date()
  await admin.save()
  res.json({ token: signAdminToken(admin.id, admin.role as AdminRole), admin: present(admin) })
}

export const adminMe: RequestHandler = (req, res) => {
  res.json({ admin: present(req.admin!) })
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["super_admin", "admin"]).default("admin"),
})

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    role: z.enum(["super_admin", "admin"]).optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à mettre à jour" })

export const listAdmins: RequestHandler = async (_req, res) => {
  const admins = await AdminModel.find().sort({ createdAt: 1 })
  res.json({ items: admins.map(present) })
}

export const createAdmin: RequestHandler = async (req, res) => {
  const { password, ...input } = createSchema.parse(req.body)
  const admin = await AdminModel.create({ ...input, passwordHash: await bcrypt.hash(password, 12) })
  res.status(201).json({ admin: present(admin) })
}

export const updateAdmin: RequestHandler = async (req, res) => {
  const { password, ...input } = updateSchema.parse(req.body)
  const admin = await AdminModel.findById(req.params.id)
  if (!admin) throw new HttpError(404, "Administrateur introuvable")
  if (admin.id === req.admin!.id && (input.active === false || input.role === "admin")) {
    throw new HttpError(400, "Vous ne pouvez pas vous désactiver ou vous rétrograder vous-même")
  }
  admin.set(input)
  if (password) admin.passwordHash = await bcrypt.hash(password, 12)
  await admin.save()
  res.json({ admin: present(admin) })
}

export const deleteAdmin: RequestHandler = async (req, res) => {
  if (req.params.id === req.admin!.id) throw new HttpError(400, "Vous ne pouvez pas supprimer votre propre compte")
  const deleted = await AdminModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Administrateur introuvable")
  res.json({ ok: true })
}

export async function seedSuperAdmin(): Promise<void> {
  if (await AdminModel.exists({})) return
  await AdminModel.create({
    name: "Super Admin",
    email: env.SUPER_ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(env.SUPER_ADMIN_PASSWORD, 12),
    role: "super_admin",
  })
  console.log(`[seed] Super admin créé → ${env.SUPER_ADMIN_EMAIL}`)
}

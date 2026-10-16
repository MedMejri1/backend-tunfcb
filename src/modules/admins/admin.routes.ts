import { Router } from "express"
import { rateLimit } from "express-rate-limit"
import { requireAdmin, requireAdminRole } from "../../middlewares/auth.js"
import {
  adminLogin,
  adminMe,
  createAdmin,
  deleteAdmin,
  listAdmins,
  updateAdmin,
} from "./admin.controller.js"

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessayez dans quelques minutes" },
})

/** Mounted at /api/admin/auth (public login) */
export const adminAuthRouter = Router()
adminAuthRouter.post("/login", loginLimiter, adminLogin)
adminAuthRouter.get("/me", requireAdmin, adminMe)

/** Mounted at /api/admin/admins (super admin only) */
export const adminsRouter = Router()
adminsRouter.use(requireAdminRole("super_admin"))
adminsRouter.get("/", listAdmins)
adminsRouter.post("/", createAdmin)
adminsRouter.patch("/:id", updateAdmin)
adminsRouter.delete("/:id", deleteAdmin)

import { Router } from "express"
import { rateLimit } from "express-rate-limit"
import { requireUser } from "../../middlewares/auth.js"
import { changePassword, login, me, register, updateMe } from "./auth.controller.js"

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de tentatives, réessaie dans quelques minutes" },
})

const router = Router()

router.post("/register", authLimiter, register)
router.post("/login", authLimiter, login)
router.get("/me", requireUser, me)
router.patch("/me", requireUser, updateMe)
router.post("/change-password", requireUser, changePassword)

export { router as authRouter }

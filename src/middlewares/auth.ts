import type { RequestHandler } from "express"
import { verifyAdminToken, verifyUserToken, type AdminRole } from "../utils/jwt.js"
import { HttpError } from "./errorHandler.js"
import { UserModel, type UserDocument } from "../modules/users/user.model.js"
import { AdminModel, type AdminDocument } from "../modules/admins/admin.model.js"

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      appUser?: UserDocument
      admin?: AdminDocument
    }
  }
}

const bearer = (header?: string) =>
  header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null

const ACTIVITY_REFRESH_MS = 5 * 60_000

/** Mobile app routes: valid user token, account not banned. */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const token = bearer(req.headers.authorization)
  if (!token) return next(new HttpError(401, "Token manquant"))

  let userId: string
  try {
    userId = verifyUserToken(token).sub
  } catch {
    return next(new HttpError(401, "Session expirée, reconnecte-toi"))
  }

  const user = await UserModel.findById(userId)
  if (!user) return next(new HttpError(401, "Compte introuvable"))
  if (user.status === "banned") {
    return next(new HttpError(403, "Compte suspendu", { reason: user.banReason }))
  }

  const now = Date.now()
  if (!user.lastActiveAt || now - user.lastActiveAt.getTime() > ACTIVITY_REFRESH_MS) {
    await UserModel.updateOne({ _id: user._id }, { lastActiveAt: new Date(now) })
  }

  req.appUser = user
  next()
}

/** Dashboard routes: valid admin token for an active admin account. */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const token = bearer(req.headers.authorization)
  if (!token) return next(new HttpError(401, "Token manquant"))

  let adminId: string
  try {
    adminId = verifyAdminToken(token).sub
  } catch {
    return next(new HttpError(401, "Session expirée, reconnectez-vous"))
  }

  const admin = await AdminModel.findById(adminId)
  if (!admin || !admin.active) return next(new HttpError(401, "Compte administrateur désactivé"))

  req.admin = admin
  next()
}

export const requireAdminRole =
  (...roles: AdminRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.admin) return next(new HttpError(401, "Non authentifié"))
    if (!roles.includes(req.admin.role as AdminRole)) {
      return next(new HttpError(403, "Action réservée au super administrateur"))
    }
    next()
  }

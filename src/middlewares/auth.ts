import type { RequestHandler } from "express"
import { signUserToken, verifyAdminToken, verifyUserToken, type AdminRole } from "../utils/jwt.js"
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
// Sliding session: a token older than a day is swapped for a fresh one, sent in
// this header and saved by the app. A supporter who opens the app at least once
// per JWT_EXPIRES_IN is never logged out.
const RENEW_AFTER_SECONDS = 24 * 3600
export const SESSION_TOKEN_HEADER = "X-Session-Token"

/** Mobile app routes: valid user token, account not banned. */
export const requireUser: RequestHandler = async (req, res, next) => {
  const token = bearer(req.headers.authorization)
  if (!token) return next(new HttpError(401, "Token manquant"))

  let userId: string
  let issuedAt: number | undefined
  try {
    const payload = verifyUserToken(token)
    userId = payload.sub
    issuedAt = payload.iat
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
  if (!issuedAt || now / 1000 - issuedAt > RENEW_AFTER_SECONDS) {
    res.setHeader(SESSION_TOKEN_HEADER, signUserToken(userId))
  }

  req.appUser = user
  next()
}

/**
 * Mobile routes also open to guests (no account): without a token the request
 * goes on with no `req.appUser`; a token, when sent, gets the requireUser checks.
 */
export const optionalUser: RequestHandler = (req, res, next) =>
  bearer(req.headers.authorization) ? requireUser(req, res, next) : next()

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

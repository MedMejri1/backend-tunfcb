import jwt, { type SignOptions } from "jsonwebtoken"
import { env } from "../config/env.js"

export interface UserTokenPayload {
  sub: string
  kind: "user"
}

export interface AdminTokenPayload {
  sub: string
  kind: "admin"
  role: AdminRole
}

export type AdminRole = "super_admin" | "admin"

export function signUserToken(userId: string): string {
  const payload: UserTokenPayload = { sub: userId, kind: "user" }
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  })
}

export function signAdminToken(adminId: string, role: AdminRole): string {
  const payload: AdminTokenPayload = { sub: adminId, kind: "admin", role }
  return jwt.sign(payload, env.ADMIN_JWT_SECRET, {
    expiresIn: env.ADMIN_JWT_EXPIRES_IN as SignOptions["expiresIn"],
  })
}

export function verifyUserToken(token: string): UserTokenPayload {
  const payload = jwt.verify(token, env.JWT_SECRET) as UserTokenPayload
  if (payload.kind !== "user") throw new Error("Wrong token kind")
  return payload
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const payload = jwt.verify(token, env.ADMIN_JWT_SECRET) as AdminTokenPayload
  if (payload.kind !== "admin") throw new Error("Wrong token kind")
  return payload
}

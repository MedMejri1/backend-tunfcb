import type { RequestHandler } from "express"
import bcrypt from "bcryptjs"
import { HttpError } from "../../middlewares/errorHandler.js"
import { signUserToken } from "../../utils/jwt.js"
import { awardPoints } from "../points/points.service.js"
import { getSettings } from "../settings/settings.service.js"
import { trackEventSafe } from "../games/missions/missions.service.js"
import { UserModel } from "../users/user.model.js"
import { generateReferralCode, generateUsername, presentUser } from "../users/user.service.js"
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "./auth.schemas.js"

export const register: RequestHandler = async (req, res) => {
  const input = registerSchema.parse(req.body)

  if (await UserModel.exists({ email: input.email })) {
    throw new HttpError(409, "Un compte existe déjà avec cet email")
  }

  const referrer = input.referralCode
    ? await UserModel.findOne({ referralCode: input.referralCode, status: "active" })
    : null
  if (input.referralCode && !referrer) throw new HttpError(400, "Code de parrainage invalide")

  const [firstName, ...rest] = input.fullName.split(/\s+/)
  const user = await UserModel.create({
    firstName,
    lastName: rest.join(" "),
    email: input.email,
    username: await generateUsername(input.fullName),
    passwordHash: await bcrypt.hash(input.password, 12),
    referralCode: await generateReferralCode(),
    referredBy: referrer?._id,
    city: input.city,
    country: input.country ?? "TN",
    lastLoginAt: new Date(),
    lastActiveAt: new Date(),
  })

  if (referrer) {
    const { referral } = await getSettings()
    await UserModel.updateOne({ _id: referrer._id }, { $inc: { referralsCount: 1 } })
    if (referral.refereePoints > 0) {
      await awardPoints({
        userId: user._id,
        type: "referral",
        points: referral.refereePoints,
        title: "Bonus de bienvenue",
        detail: `Parrainé par ${referrer.firstName}`,
      })
    }
    if (referral.referrerPoints > 0) {
      await awardPoints({
        userId: referrer._id,
        type: "referral",
        points: referral.referrerPoints,
        title: "Parrainage validé",
        detail: `${user.firstName} a rejoint l'app`,
        ref: String(user._id),
      })
    }
    trackEventSafe(referrer._id, "referral_completed")
  }

  const fresh = (await UserModel.findById(user._id))!
  res.status(201).json({ token: signUserToken(user.id), user: await presentUser(fresh) })
}

export const login: RequestHandler = async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)
  const user = await UserModel.findOne({ email }).select("+passwordHash")
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Email ou mot de passe incorrect")
  }
  if (user.status === "banned") {
    throw new HttpError(403, "Compte suspendu", { reason: user.banReason })
  }

  user.lastLoginAt = new Date()
  user.lastActiveAt = new Date()
  await user.save()
  res.json({ token: signUserToken(user.id), user: await presentUser(user) })
}

export const me: RequestHandler = async (req, res) => {
  res.json({ user: await presentUser(req.appUser!) })
}

export const updateMe: RequestHandler = async (req, res) => {
  const input = updateProfileSchema.parse(req.body)
  const user = req.appUser!
  user.set(input)
  await user.save()
  res.json({ user: await presentUser(user) })
}

export const changePassword: RequestHandler = async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body)
  const user = await UserModel.findById(req.appUser!._id).select("+passwordHash")
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, "Mot de passe actuel incorrect")
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12)
  await user.save()
  res.json({ ok: true })
}

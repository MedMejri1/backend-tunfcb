import { randomInt } from "node:crypto"
import { getSettings, levelForXp } from "../settings/settings.service.js"
import { UserModel, type UserDocument } from "./user.model.js"

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")

export async function generateUsername(seed: string): Promise<string> {
  const base = normalize(seed).slice(0, 16) || "cule"
  if (!(await UserModel.exists({ username: base }))) return base
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}${randomInt(10, 9999)}`
    if (!(await UserModel.exists({ username: candidate }))) return candidate
  }
  return `${base}${Date.now().toString(36)}`
}

// Unambiguous characters only (no 0/O, 1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export async function generateReferralCode(): Promise<string> {
  for (;;) {
    let suffix = ""
    for (let i = 0; i < 6; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    const code = `TUNFCB-${suffix}`
    if (!(await UserModel.exists({ referralCode: code }))) return code
  }
}

/** All-time rank by XP among active users (1 = best). */
export async function globalRank(user: Pick<UserDocument, "xp" | "createdAt">): Promise<number> {
  const ahead = await UserModel.countDocuments({
    status: "active",
    $or: [{ xp: { $gt: user.xp } }, { xp: user.xp, createdAt: { $lt: user.createdAt } }],
  })
  return ahead + 1
}

/** Profile returned to the mobile app. */
export async function presentUser(user: UserDocument) {
  const settings = await getSettings()
  return {
    id: user.id as string,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    email: user.email,
    city: user.city,
    country: user.country,
    balance: user.balance,
    xp: user.xp,
    ...levelForXp(user.xp, settings.levels),
    rank: await globalRank(user),
    streak: {
      current: user.streak?.current ?? 0,
      best: user.streak?.best ?? 0,
      lastClaimDay: user.streak?.lastClaimDay ?? null,
    },
    referralCode: user.referralCode,
    referralsCount: user.referralsCount,
    memberSince: user.createdAt,
  }
}

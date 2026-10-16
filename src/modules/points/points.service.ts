import { Types } from "mongoose"
import { HttpError } from "../../middlewares/errorHandler.js"
import { getSettings, levelForXp } from "../settings/settings.service.js"
import { UserModel } from "../users/user.model.js"
import { TransactionModel, type TransactionType } from "./transaction.model.js"

export interface AwardInput {
  userId: Types.ObjectId | string
  type: TransactionType
  points: number
  title: string
  detail?: string
  ref?: string
  adminId?: Types.ObjectId | string
}

/**
 * Applies a balance change and records it in the ledger. Spending only touches
 * the balance; every other type also moves XP (and therefore the level).
 * Debits never take the balance below zero.
 */
export async function awardPoints(input: AwardInput) {
  const { userId, type, points } = input
  if (!Number.isInteger(points) || points === 0) {
    throw new HttpError(400, "Le nombre de points doit être un entier non nul")
  }

  const inc: Record<string, number> = { balance: points }
  if (type !== "spent") inc.xp = points

  const filter: Record<string, unknown> = { _id: userId }
  if (points < 0) filter.balance = { $gte: -points }

  const user = await UserModel.findOneAndUpdate(filter, { $inc: inc }, { returnDocument: "after" })
  if (!user) {
    const exists = await UserModel.exists({ _id: userId })
    throw exists ? new HttpError(400, "Solde insuffisant") : new HttpError(404, "Utilisateur introuvable")
  }

  // An admin penalty can exceed the XP earned; XP never goes negative.
  if (user.xp < 0) user.xp = 0
  const { level } = levelForXp(user.xp, (await getSettings()).levels)
  if (level !== user.level || user.isModified("xp")) {
    user.level = level
    await user.save()
  }

  try {
    const transaction = await TransactionModel.create({
      user: user._id,
      type,
      points,
      balanceAfter: user.balance,
      title: input.title,
      detail: input.detail,
      ref: input.ref,
      createdBy: input.adminId,
    })
    return { user, transaction }
  } catch (err) {
    // Keep balance and ledger consistent if the ledger write fails.
    await UserModel.updateOne({ _id: user._id }, { $inc: Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, -v])) })
    throw err
  }
}

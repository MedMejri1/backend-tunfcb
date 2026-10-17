import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { UserModel } from "../users/user.model.js"
import { isExpoPushToken } from "./push.service.js"
import { MatchAlertModel, PushLogModel } from "./push.model.js"

/** Mobile: the device's Expo push token, sent after login and at each launch. */
export const savePushToken: RequestHandler = async (req, res) => {
  const { token } = z.object({ token: z.string() }).parse(req.body)
  if (!isExpoPushToken(token)) throw new HttpError(400, "Jeton de notification invalide")
  const user = req.appUser!
  // One device = one account: the previous account on this phone stops receiving.
  await UserModel.updateMany({ expoPushToken: token, _id: { $ne: user._id } }, { $unset: { expoPushToken: 1 } })
  await UserModel.updateOne({ _id: user._id }, { expoPushToken: token })
  res.json({ ok: true })
}

/** Mobile: called on logout so the phone stops receiving this account's pushes. */
export const deletePushToken: RequestHandler = async (req, res) => {
  await UserModel.updateOne({ _id: req.appUser!._id }, { $unset: { expoPushToken: 1 } })
  res.json({ ok: true })
}

const prefsSchema = z.object({ matches: z.boolean(), games: z.boolean() }).partial()

export const updateNotificationPrefs: RequestHandler = async (req, res) => {
  const input = prefsSchema.parse(req.body)
  const $set = Object.fromEntries(Object.entries(input).map(([key, value]) => [`notificationPrefs.${key}`, value]))
  const user = await UserModel.findByIdAndUpdate(req.appUser!._id, { $set }, { new: true })
  res.json({
    notificationPrefs: {
      matches: user?.notificationPrefs?.matches ?? true,
      games: user?.notificationPrefs?.games ?? true,
    },
  })
}

/** Dashboard: registered devices and the latest automatic pushes. */
export const adminPushStatus: RequestHandler = async (_req, res) => {
  const withDevice = { status: "active" as const, expoPushToken: { $exists: true, $ne: null } }
  const [devices, matchesOff, gamesOff, daily, matches] = await Promise.all([
    UserModel.countDocuments(withDevice),
    UserModel.countDocuments({ ...withDevice, "notificationPrefs.matches": false }),
    UserModel.countDocuments({ ...withDevice, "notificationPrefs.games": false }),
    PushLogModel.find().sort({ createdAt: -1 }).limit(6).lean(),
    MatchAlertModel.find().sort({ updatedAt: -1 }).limit(4).lean(),
  ])
  res.json({
    devices,
    matchesOptIn: devices - matchesOff,
    gamesOptIn: devices - gamesOff,
    recentDaily: daily.map((d) => ({ key: d.key, sent: d.sent, at: d.createdAt })),
    recentMatches: matches.map((m) => ({ espnEventId: m.espnEventId, reminderSentAt: m.reminderSentAt, endSentAt: m.endSentAt })),
  })
}

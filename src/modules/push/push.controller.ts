import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { UserModel } from "../users/user.model.js"
import { isExpoPushToken } from "./push.service.js"
import { GuestDeviceModel, MatchAlertModel, PushLogModel } from "./push.model.js"

/** Mobile: the device's Expo push token, sent after login and at each launch. */
export const savePushToken: RequestHandler = async (req, res) => {
  const { token } = z.object({ token: z.string() }).parse(req.body)
  if (!isExpoPushToken(token)) throw new HttpError(400, "Jeton de notification invalide")
  const user = req.appUser!
  // One device = one account: the previous account (or guest use) on this phone stops receiving.
  await UserModel.updateMany({ expoPushToken: token, _id: { $ne: user._id } }, { $unset: { expoPushToken: 1 } })
  await GuestDeviceModel.deleteOne({ token })
  await UserModel.updateOne({ _id: user._id }, { expoPushToken: token })
  res.json({ ok: true })
}

const guestTokenSchema = z.object({ token: z.string(), matches: z.boolean().optional() })

/** Mobile, no account: the phone receives the match pushes (unless `matches` is false). */
export const saveGuestPushToken: RequestHandler = async (req, res) => {
  const { token, matches } = guestTokenSchema.parse(req.body)
  if (!isExpoPushToken(token)) throw new HttpError(400, "Jeton de notification invalide")
  // The phone is now used as a guest: no account receives on it anymore.
  await UserModel.updateMany({ expoPushToken: token }, { $unset: { expoPushToken: 1 } })
  await GuestDeviceModel.updateOne(
    { token },
    { $set: { lastSeenAt: new Date(), ...(matches === undefined ? {} : { matches }) } },
    { upsert: true },
  )
  res.json({ ok: true })
}

/** Mobile: leaving guest mode. */
export const deleteGuestPushToken: RequestHandler = async (req, res) => {
  const { token } = z.object({ token: z.string() }).parse(req.body)
  await GuestDeviceModel.deleteOne({ token })
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
  const [devices, matchesOff, gamesOff, guests, daily, matches] = await Promise.all([
    UserModel.countDocuments(withDevice),
    UserModel.countDocuments({ ...withDevice, "notificationPrefs.matches": false }),
    UserModel.countDocuments({ ...withDevice, "notificationPrefs.games": false }),
    GuestDeviceModel.countDocuments({ matches: { $ne: false } }),
    PushLogModel.find().sort({ createdAt: -1 }).limit(6).lean(),
    MatchAlertModel.find().sort({ updatedAt: -1 }).limit(4).lean(),
  ])
  res.json({
    devices,
    guests,
    matchesOptIn: devices - matchesOff,
    gamesOptIn: devices - gamesOff,
    recentDaily: daily.map((d) => ({ key: d.key, sent: d.sent, at: d.createdAt })),
    recentMatches: matches.map((m) => ({ espnEventId: m.espnEventId, reminderSentAt: m.reminderSentAt, endSentAt: m.endSentAt })),
  })
}

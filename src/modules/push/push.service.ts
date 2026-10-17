import type { Types } from "mongoose"
import { env } from "../../config/env.js"
import { UserModel } from "../users/user.model.js"
import { GuestDeviceModel } from "./push.model.js"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
// Expo accepts at most 100 messages per request.
const CHUNK_SIZE = 100

/** Android channels created by the app (sound and importance per kind). */
export type PushChannel = "matches" | "games" | "announcements"

export interface PushContent {
  title: string
  body: string
  channel: PushChannel
  /** Read by the app when the notification is tapped (where to navigate). */
  data?: Record<string, string>
}

export const isExpoPushToken = (token: unknown): token is string =>
  typeof token === "string" && /^Expo(nent)?PushToken\[.+\]$/.test(token)

interface ExpoTicket {
  status: "ok" | "error"
  message?: string
  details?: { error?: string }
}

/** Sends through Expo's push service; devices that uninstalled the app lose their token. */
export async function sendPush(messages: Array<PushContent & { to: string }>): Promise<number> {
  let accepted = 0
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE)
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(
          chunk.map(({ to, title, body, data, channel }) => ({
            to,
            title,
            body,
            data,
            channelId: channel,
            sound: "default",
            priority: "high",
          })),
        ),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        console.error("[push] Expo a refusé l'envoi :", res.status, await res.text())
        continue
      }
      const { data: tickets = [] } = (await res.json()) as { data?: ExpoTicket[] }
      const unregistered: string[] = []
      tickets.forEach((ticket, j) => {
        if (ticket.status === "ok") accepted++
        else if (ticket.details?.error === "DeviceNotRegistered") unregistered.push(chunk[j].to)
        else console.warn("[push] message refusé :", ticket.message)
      })
      if (unregistered.length) {
        await UserModel.updateMany({ expoPushToken: { $in: unregistered } }, { $unset: { expoPushToken: 1 } })
        await GuestDeviceModel.deleteMany({ token: { $in: unregistered } })
      }
    } catch (err) {
      console.error("[push] envoi impossible :", (err as Error).message)
    }
  }
  return accepted
}

export type PushPreference = "matches" | "games"

export interface PushRecipient {
  _id: Types.ObjectId
  firstName: string
  expoPushToken: string
  streak?: { current?: number; lastClaimDay?: string | null }
  games?: { wheelLastSpinAt?: Date | null; adsDay?: string | null; adsCount?: number }
}

/**
 * Pushes to every active user with a registered device (optionally only
 * those who accept `preference`, or only `userIds`). `build` personalises
 * the message; returning null skips the user.
 */
export async function pushToUsers(
  options: { preference?: PushPreference; userIds?: Array<Types.ObjectId | string> },
  build: (user: PushRecipient) => PushContent | null,
): Promise<number> {
  const filter: Record<string, unknown> = { status: "active", expoPushToken: { $exists: true, $ne: null } }
  // Users created before the preferences existed have no value: they accept.
  if (options.preference) filter[`notificationPrefs.${options.preference}`] = { $ne: false }
  if (options.userIds) filter._id = { $in: options.userIds }

  const messages: Array<PushContent & { to: string }> = []
  const users = UserModel.find(filter).select("firstName expoPushToken streak games").lean<PushRecipient[]>().cursor()
  for await (const user of users) {
    if (!isExpoPushToken(user.expoPushToken)) continue
    const content = build(user)
    if (content) messages.push({ ...content, to: user.expoPushToken })
  }
  return messages.length ? sendPush(messages) : 0
}

/** Match pushes also reach the phones used as a guest (unless they turned them off). */
export async function pushToGuests(content: PushContent): Promise<number> {
  const devices = await GuestDeviceModel.find({ matches: { $ne: false } }).select("token").lean()
  const messages = devices.filter((d) => isExpoPushToken(d.token)).map((d) => ({ ...content, to: d.token }))
  return messages.length ? sendPush(messages) : 0
}

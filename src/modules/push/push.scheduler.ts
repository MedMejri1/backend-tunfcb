import { dayKey, previousDayKey, zonedParts } from "../../utils/dates.js"
import { getSettings } from "../settings/settings.service.js"
import type { Settings } from "../settings/settings.schemas.js"
import { NotificationModel } from "../notifications/notification.model.js"
import { QuizAttemptModel } from "../games/quiz/quiz.model.js"
import { BARCA_ESPN_ID, fetchBarcaFixtures, type EspnFixture } from "../games/predictions/espn.js"
import { syncPredictionMatches } from "../games/predictions/predictions.service.js"
import { claimDailyPush, claimMatchAlert, PushLogModel } from "./push.model.js"
import { pushToUsers, type PushRecipient } from "./push.service.js"

const TICK_MS = 60_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE

// A reminder caught up late (server waking up) still goes out until 2 min after kickoff.
const REMINDER_LATE_MS = 2 * MINUTE
// Full-time push only for a match that kicked off less than 4 h ago (not old results).
const MATCH_END_WINDOW_MS = 4 * HOUR
// Daily reminders missed at their time (server asleep) are still sent within 2 h.
const DAILY_GRACE_MINUTES = 120

let fixtures: EspnFixture[] = []
let fixturesFetchedAt = 0

const teamName = (team: EspnFixture["home"]) => (team.id === BARCA_ESPN_ID ? "Barça" : team.name)
const opponentOf = (f: EspnFixture) => teamName(f.home.id === BARCA_ESPN_ID ? f.away : f.home)

/** A match is starting soon or being played: its state is polled every minute. */
const aroundMatch = (now: number) =>
  fixtures.some((f) => {
    const kickoff = f.kickoff.getTime()
    return f.state !== "post" && now > kickoff - 15 * MINUTE && now < kickoff + MATCH_END_WINDOW_MS
  })

async function refreshFixtures(now: number) {
  const maxAge = aroundMatch(now) ? MINUTE : 10 * MINUTE
  if (now - fixturesFetchedAt < maxAge - 5_000) return
  fixtures = await fetchBarcaFixtures()
  fixturesFetchedAt = now
}

async function matchReminders(now: number, settings: Settings) {
  const { enabled, minutesBefore } = settings.push.matchReminder
  if (!enabled) return
  for (const f of fixtures) {
    const msLeft = f.kickoff.getTime() - now
    if (f.state !== "pre" || msLeft > minutesBefore * MINUTE || msLeft < -REMINDER_LATE_MS) continue
    if (!(await claimMatchAlert(f.espnEventId, "reminderSentAt"))) continue

    const minutes = Math.round(msLeft / MINUTE)
    const sent = await pushToUsers({ preference: "matches" }, () => ({
      channel: "matches",
      title: minutes >= 1 ? `⏱️ Coup d'envoi dans ${minutes} min` : "⚽ Coup d'envoi !",
      body: `${teamName(f.home)} – ${teamName(f.away)} · ${f.competition}. Allez Barça ! 🔵🔴`,
      data: { type: "match", matchId: f.espnEventId },
    }))
    console.log(`[push] rappel avant-match ${f.espnEventId} → ${sent} appareil(s)`)
  }
}

async function matchEnds(now: number, settings: Settings) {
  if (!settings.push.matchEnd.enabled) return
  for (const f of fixtures) {
    if (f.state !== "post" || now - f.kickoff.getTime() > MATCH_END_WINDOW_MS) continue
    if (f.home.score === undefined || f.away.score === undefined) continue
    if (!(await claimMatchAlert(f.espnEventId, "endSentAt"))) continue

    // Settle the predictions now so the points are there when users open the app.
    await syncPredictionMatches().catch((err) => console.error("[push] règlement des pronostics :", (err as Error).message))

    const barcaHome = f.home.id === BARCA_ESPN_ID
    const scored = barcaHome ? f.home.score : f.away.score
    const conceded = barcaHome ? f.away.score : f.home.score
    const verdict = scored > conceded ? "Victoire du Barça ! 🎉" : scored < conceded ? "Défaite du Barça 😔" : "Match nul"
    const title = `Fin du match · ${verdict}`
    const score = `${teamName(f.home)} ${f.home.score}-${f.away.score} ${teamName(f.away)}`

    await NotificationModel.create({ category: "match", title, message: `${score} (${f.competition}).`, ref: f.espnEventId })
    const sent = await pushToUsers({ preference: "matches" }, () => ({
      channel: "matches",
      title,
      body: `${score}. Découvre les points de tes pronostics 🎯`,
      data: { type: "match", matchId: f.espnEventId },
    }))
    console.log(`[push] fin de match ${f.espnEventId} → ${sent} appareil(s)`)
  }
}

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(":").map(Number)
  return h * 60 + m
}

/** "a", "a et b", "a, b et c" */
const listFr = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`

function morningMessage(settings: Settings, today: string) {
  const { ads, predictions } = settings
  const match = fixtures.find((f) => f.state === "pre" && dayKey(f.kickoff) === today)
  const matchLine = match
    ? ` Et aujourd'hui Barça – ${opponentOf(match)} : pronostique le score (jusqu'à +${predictions.exactScorePoints} BP) !`
    : ""
  const adsLine = ads.maxPerDay > 0 ? ` et ${ads.maxPerDay} pubs à +${ads.rewardPerAd} BP` : ""

  return (user: PushRecipient) => ({
    channel: "games" as const,
    title: "☀️ Tes jeux du jour sont prêts",
    body: `Bonjour ${user.firstName} ! Bonus quotidien, quiz du jour, roue de la fortune${adsLine} t'attendent.${matchLine}`,
    data: { type: "games" },
  })
}

async function eveningMessage(settings: Settings, now: number, today: string) {
  const { ads, wheel } = settings
  const quizDone = new Set((await QuizAttemptModel.distinct("user", { dayKey: today })).map(String))
  const yesterday = previousDayKey(today)

  return (user: PushRecipient) => {
    const left: string[] = []
    const bonusLeft = user.streak?.lastClaimDay !== today
    if (bonusLeft) left.push("ton bonus quotidien")
    if (!quizDone.has(String(user._id))) left.push("le quiz du jour")
    const lastSpin = user.games?.wheelLastSpinAt ? new Date(user.games.wheelLastSpinAt).getTime() : 0
    if (now - lastSpin >= wheel.cooldownHours * HOUR) left.push("la roue")
    const adsLeft = ads.maxPerDay - (user.games?.adsDay === today ? (user.games.adsCount ?? 0) : 0)
    if (adsLeft > 0) left.push(`${adsLeft} pub${adsLeft > 1 ? "s" : ""} à +${ads.rewardPerAd} BP`)
    if (!left.length) return null

    const streak = user.streak?.lastClaimDay === yesterday ? (user.streak.current ?? 0) : 0
    return {
      channel: "games" as const,
      title: bonusLeft && streak > 0 ? `🔥 Ta série de ${streak} jour${streak > 1 ? "s" : ""} est en danger` : "🎯 Il te reste des BP à gagner",
      body: `Avant minuit : ${listFr(left)}.`,
      data: { type: "games" },
    }
  }
}

async function dailyReminders(now: number, settings: Settings) {
  const local = zonedParts(new Date(now))
  const minuteOfDay = local.hour * 60 + local.minute
  const today = dayKey(new Date(now))

  for (const kind of ["morning", "evening"] as const) {
    const { enabled, time } = settings.push[kind]
    const start = minutesOf(time)
    if (!enabled || minuteOfDay < start || minuteOfDay > start + DAILY_GRACE_MINUTES) continue
    const key = `${kind}:${today}`
    if (!(await claimDailyPush(key))) continue

    const build = kind === "morning" ? morningMessage(settings, today) : await eveningMessage(settings, now, today)
    const sent = await pushToUsers({ preference: "games" }, build)
    await PushLogModel.updateOne({ key }, { sent })
    console.log(`[push] rappel ${kind === "morning" ? "du matin" : "du soir"} → ${sent} appareil(s)`)
  }
}

let running = false

async function tick() {
  if (running) return
  running = true
  try {
    const now = Date.now()
    const settings = await getSettings()
    await refreshFixtures(now).catch((err) => console.error("[push] ESPN :", (err as Error).message))
    await matchReminders(now, settings)
    await matchEnds(now, settings)
    await dailyReminders(now, settings)
  } catch (err) {
    console.error("[push] planificateur :", (err as Error).message)
  } finally {
    running = false
  }
}

let timer: NodeJS.Timeout | null = null

/** Checks every minute for the automatic pushes (match, morning, evening). */
export function startPushScheduler() {
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), TICK_MS)
}

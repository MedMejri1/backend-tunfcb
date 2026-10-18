import { Types } from "mongoose"
import { HttpError } from "../../../middlewares/errorHandler.js"
import { awardPoints } from "../../points/points.service.js"
import { getSettings } from "../../settings/settings.service.js"
import { NotificationModel } from "../../notifications/notification.model.js"
import type { UserDocument } from "../../users/user.model.js"
import { trackEventSafe } from "../missions/missions.service.js"
import { fetchBarcaFixtures, type EspnFixture } from "./espn.js"
import { PredictionMatchModel, PredictionModel } from "./prediction.model.js"

// Matches open for predictions: everything kicking off in the next 21 days,
// and never fewer than the next 5, so a played match is replaced by the
// following one right away even when it is weeks ahead (winter break…).
const OPEN_WINDOW_DAYS = 21
const MIN_OPEN_MATCHES = 5

/** ESPN ids of the upcoming fixtures that must be open for predictions. */
export function fixturesToOpen(fixtures: EspnFixture[], now = Date.now()): Set<string> {
  const horizon = now + OPEN_WINDOW_DAYS * 86_400_000
  return new Set(
    fixtures
      .filter((f) => f.state === "pre" && f.kickoff.getTime() > now)
      .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime())
      .filter((f, i) => i < MIN_OPEN_MATCHES || f.kickoff.getTime() < horizon)
      .map((f) => f.espnEventId),
  )
}

type MatchDoc = Awaited<ReturnType<typeof PredictionMatchModel.findOne>>

async function closesAt(kickoff: Date): Promise<Date> {
  const { predictions } = await getSettings()
  return new Date(kickoff.getTime() - predictions.closeMinutesBeforeKickoff * 60_000)
}

const sign = (n: number) => Math.sign(n)

function scorePrediction(p: { home: number; away: number }, r: { home: number; away: number }) {
  if (p.home === r.home && p.away === r.away) return "exact" as const
  return sign(p.home - p.away) === sign(r.home - r.away) ? ("correct" as const) : ("wrong" as const)
}

/** Settles a match once: scores every prediction and pays the winners. */
export async function settleMatch(matchId: Types.ObjectId | string, result: { home: number; away: number }) {
  const match = await PredictionMatchModel.findOneAndUpdate(
    { _id: matchId, status: { $in: ["open", "closed"] } },
    { status: "settled", result, settledAt: new Date() },
    { returnDocument: "after" },
  )
  if (!match) throw new HttpError(400, "Match introuvable ou déjà réglé")

  const { predictions: rules } = await getSettings()
  const label = `${match.home.short} ${result.home}-${result.away} ${match.away.short}`
  const pending = await PredictionModel.find({ match: match._id, outcome: "pending" })

  let winners = 0
  for (const prediction of pending) {
    const outcome = scorePrediction(prediction, result)
    const points =
      outcome === "exact" ? rules.exactScorePoints : outcome === "correct" ? rules.correctOutcomePoints : 0

    // Guard on "pending" so a retry never pays twice.
    const claimed = await PredictionModel.updateOne(
      { _id: prediction._id, outcome: "pending" },
      { outcome, pointsAwarded: points },
    )
    if (claimed.modifiedCount === 0 || points === 0) continue

    winners++
    await awardPoints({
      userId: prediction.user,
      type: "prediction",
      points,
      title: outcome === "exact" ? "Score exact !" : "Bon pronostic",
      detail: `${label} · ton prono ${prediction.home}-${prediction.away}`,
      ref: String(prediction._id),
    })
    await NotificationModel.create({
      user: prediction.user,
      category: "reward",
      title: outcome === "exact" ? "Score exact ! 🎯" : "Bon pronostic ✅",
      message: `${label} : ton pronostic ${prediction.home}-${prediction.away} te rapporte ${points} BP.`,
    })
  }

  return { match, settled: pending.length, winners }
}

export async function cancelMatch(matchId: string) {
  const match = await PredictionMatchModel.findOneAndUpdate(
    { _id: matchId, status: { $in: ["open", "closed"] } },
    { status: "cancelled" },
    { returnDocument: "after" },
  )
  if (!match) throw new HttpError(400, "Match introuvable ou déjà réglé")
  await PredictionModel.updateMany({ match: match._id, outcome: "pending" }, { outcome: "void" })
  return match
}

/**
 * Pulls Barça fixtures from ESPN: opens upcoming matches, closes started ones
 * and settles finished ones with the official score.
 */
export async function syncPredictionMatches() {
  const fixtures = await fetchBarcaFixtures()
  const toOpen = fixturesToOpen(fixtures)
  let created = 0
  let settled = 0

  for (const f of fixtures) {
    const existing = await PredictionMatchModel.findOne({ espnEventId: f.espnEventId })

    if (!existing) {
      if (toOpen.has(f.espnEventId)) {
        await PredictionMatchModel.create({
          espnEventId: f.espnEventId,
          competition: f.competition,
          home: { id: f.home.id, name: f.home.name, short: f.home.short, logo: f.home.logo },
          away: { id: f.away.id, name: f.away.name, short: f.away.short, logo: f.away.logo },
          kickoff: f.kickoff,
          venue: f.venue,
        })
        created++
      }
      continue
    }

    if (existing.status === "open" && f.state === "pre") {
      // Rescheduled match: follow ESPN's kickoff.
      if (existing.kickoff.getTime() !== f.kickoff.getTime()) {
        existing.kickoff = f.kickoff
        await existing.save()
      }
    }

    if (
      (existing.status === "open" || existing.status === "closed") &&
      f.state === "post" &&
      f.home.score !== undefined &&
      f.away.score !== undefined
    ) {
      await settleMatch(existing._id, { home: f.home.score, away: f.away.score })
      settled++
    }
  }

  const closed = await closeStartedMatches()
  return { fixtures: fixtures.length, created, settled, closed }
}

export async function closeStartedMatches(): Promise<number> {
  const { predictions } = await getSettings()
  const cutoff = new Date(Date.now() + predictions.closeMinutesBeforeKickoff * 60_000)
  const res = await PredictionMatchModel.updateMany({ status: "open", kickoff: { $lte: cutoff } }, { status: "closed" })
  return res.modifiedCount
}

const presentMatch = (m: NonNullable<MatchDoc>, closes: Date) => ({
  id: String(m._id),
  competition: m.competition,
  home: m.home,
  away: m.away,
  kickoff: m.kickoff,
  closesAt: closes,
  venue: m.venue,
  status: m.status,
  result: m.status === "settled" ? m.result : null,
  predictionsCount: m.predictionsCount,
})

/** Open matches plus recent settled ones, each with the user's prediction. */
export async function listPredictionsForUser(user: UserDocument) {
  const { predictions: rules } = await getSettings()
  const [upcoming, recent] = await Promise.all([
    PredictionMatchModel.find({ status: { $in: ["open", "closed"] } }).sort({ kickoff: 1 }).limit(10),
    PredictionMatchModel.find({ status: "settled" }).sort({ kickoff: -1 }).limit(5),
  ])
  const matches = [...upcoming, ...recent]
  const mine = await PredictionModel.find({ user: user._id, match: { $in: matches.map((m) => m._id) } }).lean()

  const withPrediction = async (m: (typeof matches)[number]) => {
    const p = mine.find((x) => x.match.equals(m._id))
    const closes = await closesAt(m.kickoff)
    return {
      ...presentMatch(m, closes),
      isOpen: m.status === "open" && closes.getTime() > Date.now(),
      myPrediction: p
        ? { home: p.home, away: p.away, outcome: p.outcome, pointsAwarded: p.pointsAwarded }
        : null,
    }
  }

  return {
    rules: { exactScorePoints: rules.exactScorePoints, correctOutcomePoints: rules.correctOutcomePoints },
    upcoming: await Promise.all(upcoming.map(withPrediction)),
    recent: await Promise.all(recent.map(withPrediction)),
  }
}

export async function submitPrediction(user: UserDocument, matchId: string, home: number, away: number) {
  const match = await PredictionMatchModel.findById(matchId)
  if (!match) throw new HttpError(404, "Match introuvable")
  if (match.status !== "open" || (await closesAt(match.kickoff)).getTime() <= Date.now()) {
    throw new HttpError(400, "Les pronostics sont fermés pour ce match")
  }

  const existing = await PredictionModel.findOne({ user: user._id, match: match._id })
  if (existing) {
    existing.home = home
    existing.away = away
    await existing.save()
    return { created: false, prediction: existing }
  }

  try {
    const prediction = await PredictionModel.create({ user: user._id, match: match._id, home, away })
    await PredictionMatchModel.updateOne({ _id: match._id }, { $inc: { predictionsCount: 1 } })
    trackEventSafe(user._id, "prediction_made")
    return { created: true, prediction }
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new HttpError(409, "Pronostic déjà enregistré")
    throw err
  }
}

let syncTimer: NodeJS.Timeout | null = null

export function startPredictionSync(intervalMinutes: number) {
  if (intervalMinutes <= 0 || syncTimer) return
  const run = () =>
    syncPredictionMatches()
      .then((r) => {
        if (r.created || r.settled || r.closed) console.log("[predictions] sync", r)
      })
      .catch((err) => console.error("[predictions] sync failed:", (err as Error).message))
  void run()
  syncTimer = setInterval(run, intervalMinutes * 60_000)
}

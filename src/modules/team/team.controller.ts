import type { RequestHandler } from "express"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { BARCA_ESPN_ID, ESPN_BASE } from "../games/predictions/espn.js"
import { INJURY_SEVERITIES, InjuryModel } from "./injury.model.js"

const presentInjury = (i: {
  _id: unknown
  playerId: string
  playerName: string
  position?: string | null
  injuryType: string
  expectedReturn?: Date | null
  returnNote?: string | null
  severity: string
  active: boolean
  healedAt?: Date | null
  updatedAt: Date
}) => ({
  id: String(i._id),
  playerId: i.playerId,
  playerName: i.playerName,
  position: i.position ?? "",
  injuryType: i.injuryType,
  expectedReturn: i.expectedReturn ?? null,
  returnNote: i.returnNote ?? "",
  severity: i.severity,
  active: i.active,
  healedAt: i.healedAt ?? null,
  updatedAt: i.updatedAt,
})

// ------------------------------------------------------------ Mobile

/** Current infirmary, merged by the app with what ESPN publishes (usually nothing for LaLiga). */
export const teamInjuries: RequestHandler = async (_req, res) => {
  const injuries = await InjuryModel.find({ active: true }).sort({ updatedAt: -1 }).lean()
  res.json({ items: injuries.map(presentInjury) })
}

// ------------------------------------------------------------ Admin

export const adminListInjuries: RequestHandler = async (_req, res) => {
  const since = new Date(Date.now() - 60 * 86_400_000)
  const [active, healed] = await Promise.all([
    InjuryModel.find({ active: true }).sort({ updatedAt: -1 }).lean(),
    InjuryModel.find({ active: false, healedAt: { $gte: since } }).sort({ healedAt: -1 }).limit(30).lean(),
  ])
  res.json({ active: active.map(presentInjury), healed: healed.map(presentInjury) })
}

const injurySchema = z.object({
  playerId: z.string().trim().min(1, "Choisis un joueur"),
  playerName: z.string().trim().min(2).max(80),
  position: z.string().trim().max(40).default(""),
  injuryType: z.string().trim().min(2, "Indique la blessure").max(120),
  expectedReturn: z.coerce.date().nullable().default(null),
  returnNote: z.string().trim().max(80).default(""),
  severity: z.enum(INJURY_SEVERITIES).default("moderate"),
})

export const adminCreateInjury: RequestHandler = async (req, res) => {
  const input = injurySchema.parse(req.body)
  if (await InjuryModel.exists({ playerId: input.playerId, active: true })) {
    throw new HttpError(409, `${input.playerName} est déjà à l'infirmerie : modifie sa fiche`)
  }
  const injury = await InjuryModel.create({ ...input, updatedBy: req.admin!._id })
  res.status(201).json({ injury: presentInjury(injury.toObject()) })
}

export const adminUpdateInjury: RequestHandler = async (req, res) => {
  const input = injurySchema.partial().extend({ active: z.boolean().optional() }).parse(req.body)
  const injury = await InjuryModel.findByIdAndUpdate(
    req.params.id,
    {
      ...input,
      updatedBy: req.admin!._id,
      // Marking the player as back keeps the injury in the history.
      ...(input.active === false ? { healedAt: new Date() } : input.active === true ? { healedAt: null } : {}),
    },
    { returnDocument: "after" },
  ).lean()
  if (!injury) throw new HttpError(404, "Blessure introuvable")
  res.json({ injury: presentInjury(injury) })
}

export const adminDeleteInjury: RequestHandler = async (req, res) => {
  const deleted = await InjuryModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Blessure introuvable")
  res.json({ ok: true })
}

interface EspnRosterAthlete {
  id: string
  displayName?: string
  jersey?: string
  position?: { displayName?: string; abbreviation?: string }
}

const POSITIONS: Record<string, string> = { G: "Gardien", D: "Défenseur", M: "Milieu", F: "Attaquant" }

/** Squad list for the player picker (straight from ESPN). */
export const adminTeamRoster: RequestHandler = async (_req, res) => {
  const url = `${ESPN_BASE}/esp.1/teams/${BARCA_ESPN_ID}/roster`
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new HttpError(502, "Effectif ESPN indisponible, réessaie dans un instant")
  const data = (await response.json()) as { athletes?: EspnRosterAthlete[] }
  const players = (data.athletes ?? [])
    .map((a) => ({
      id: a.id,
      name: a.displayName ?? "",
      number: Number(a.jersey ?? 0) || null,
      position: POSITIONS[(a.position?.abbreviation ?? "").charAt(0).toUpperCase()] ?? a.position?.displayName ?? "",
    }))
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
  res.json({ players })
}

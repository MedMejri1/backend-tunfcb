import { HttpError } from "../../middlewares/errorHandler.js"

// Free open-source API, no key: https://tn-municipality-api.vercel.app
// It sends no CORS headers, so the app and the dashboard get the list from here.
const LOCATIONS_URL = "https://tn-municipality-api.vercel.app/api/municipalities"
const CACHE_MS = 24 * 60 * 60_000
// API down with a copy in memory: the old copy is served, a new try in 10 min.
const RETRY_MS = 10 * 60_000

export interface TnDelegation {
  value: string
  name: string
}

export interface TnGovernorate {
  value: string
  name: string
  delegations: TnDelegation[]
}

interface ApiLocality {
  Name: string
  Value: string
}

interface ApiGovernorate {
  Name: string
  Value: string
  Delegations?: ApiLocality[]
}

/** "BEN AROUS" → "Ben Arous"; drops the "(TUNIS)" suffix some names carry. */
const label = (raw: string) =>
  raw
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, letter: string) => sep + letter.toUpperCase())

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr")

async function download(): Promise<TnGovernorate[]> {
  const res = await fetch(LOCATIONS_URL, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as ApiGovernorate[]

  const governorates = data
    .map((g) => {
      // The API lists localities: the ones sharing a Value make up one delegation.
      const delegations = new Map<string, TnDelegation>()
      for (const l of g.Delegations ?? []) {
        if (!delegations.has(l.Value)) delegations.set(l.Value, { value: l.Value, name: label(l.Value) })
      }
      return { value: g.Value, name: label(g.Name), delegations: [...delegations.values()].sort(byName) }
    })
    .sort(byName)
  if (!governorates.length) throw new Error("liste vide")
  return governorates
}

let cache: { at: number; governorates: TnGovernorate[] } | null = null
let inFlight: Promise<TnGovernorate[]> | null = null

/** Tunisia's 24 governorates and their delegations, cached for a day. */
export async function getGovernorates(): Promise<TnGovernorate[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.governorates

  inFlight ??= download().finally(() => {
    inFlight = null
  })
  try {
    const governorates = await inFlight
    cache = { at: Date.now(), governorates }
    return governorates
  } catch (err) {
    console.error("[cafes] liste des villes indisponible :", (err as Error).message)
    if (cache) {
      cache.at = Date.now() - CACHE_MS + RETRY_MS
      return cache.governorates
    }
    throw new HttpError(502, "Liste des villes indisponible, réessaie dans un instant")
  }
}

/** Checks a governorate / delegation pair and returns it with its display names. */
export async function resolveLocation(governorate: string, delegation: string) {
  const gov = (await getGovernorates()).find((g) => g.value === governorate)
  const del = gov?.delegations.find((d) => d.value === delegation)
  if (!gov || !del) throw new HttpError(400, "Gouvernorat ou délégation inconnu")
  return { governorate: gov.value, governorateName: gov.name, delegation: del.value, delegationName: del.name }
}

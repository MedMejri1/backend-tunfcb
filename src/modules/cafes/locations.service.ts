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
  Latitude?: number
  Longitude?: number
}

export interface GeoPoint {
  lat: number
  lng: number
}

/** A locality of the API, with the codes of its delegation. */
interface Place extends GeoPoint {
  governorate: string
  delegation: string
}

/** Everything read from the API: the lists, and where each locality / delegation lies. */
interface Gazetteer {
  governorates: TnGovernorate[]
  places: Place[]
  /** Average position of each delegation's localities, keyed by delegationKey(). */
  centres: Map<string, GeoPoint>
}

export const delegationKey = (governorate: string, delegation: string) => `${governorate}|${delegation}`

/** Great-circle distance in km. */
export const distanceKm = (a: GeoPoint, b: GeoPoint) => {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const hasCoords = (l: ApiLocality): l is ApiLocality & { Latitude: number; Longitude: number } =>
  typeof l.Latitude === "number" && typeof l.Longitude === "number" && (l.Latitude !== 0 || l.Longitude !== 0)

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

async function download(): Promise<Gazetteer> {
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

  const places: Place[] = data.flatMap((g) =>
    (g.Delegations ?? [])
      .filter(hasCoords)
      .map((l) => ({ governorate: g.Value, delegation: l.Value, lat: l.Latitude, lng: l.Longitude })),
  )
  const sums = new Map<string, { lat: number; lng: number; n: number }>()
  for (const p of places) {
    const key = delegationKey(p.governorate, p.delegation)
    const sum = sums.get(key) ?? { lat: 0, lng: 0, n: 0 }
    sums.set(key, { lat: sum.lat + p.lat, lng: sum.lng + p.lng, n: sum.n + 1 })
  }
  const centres = new Map([...sums].map(([key, s]) => [key, { lat: s.lat / s.n, lng: s.lng / s.n }]))

  return { governorates, places, centres }
}

let cache: { at: number; gazetteer: Gazetteer } | null = null
let inFlight: Promise<Gazetteer> | null = null

/** The API's lists and coordinates, cached for a day. */
async function getGazetteer(): Promise<Gazetteer> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.gazetteer

  inFlight ??= download().finally(() => {
    inFlight = null
  })
  try {
    const gazetteer = await inFlight
    cache = { at: Date.now(), gazetteer }
    return gazetteer
  } catch (err) {
    console.error("[cafes] liste des villes indisponible :", (err as Error).message)
    if (cache) {
      cache.at = Date.now() - CACHE_MS + RETRY_MS
      return cache.gazetteer
    }
    throw new HttpError(502, "Liste des villes indisponible, réessaie dans un instant")
  }
}

/** Tunisia's 24 governorates and their delegations. */
export async function getGovernorates(): Promise<TnGovernorate[]> {
  return (await getGazetteer()).governorates
}

/** Centre of every delegation (average of its localities). */
export async function getDelegationCentres(): Promise<Map<string, GeoPoint>> {
  return (await getGazetteer()).centres
}

/** The delegation around a point: the one of the nearest locality, with its distance. */
export async function nearestArea(point: GeoPoint) {
  const { places, governorates } = await getGazetteer()
  let best: Place | null = null
  let bestKm = Infinity
  for (const p of places) {
    const km = distanceKm(point, p)
    if (km < bestKm) {
      best = p
      bestKm = km
    }
  }
  if (!best) return null
  const gov = governorates.find((g) => g.value === best.governorate)
  const del = gov?.delegations.find((d) => d.value === best.delegation)
  return gov && del ? { governorateName: gov.name, delegationName: del.name, distanceKm: bestKm } : null
}

/** Checks a governorate / delegation pair and returns it with its display names. */
export async function resolveLocation(governorate: string, delegation: string) {
  const gov = (await getGovernorates()).find((g) => g.value === governorate)
  const del = gov?.delegations.find((d) => d.value === delegation)
  if (!gov || !del) throw new HttpError(400, "Gouvernorat ou délégation inconnu")
  return { governorate: gov.value, governorateName: gov.name, delegation: del.value, delegationName: del.name }
}

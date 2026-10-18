import type { GeoPoint } from "./locations.service.js"

// Where Google Maps links carry the position: the place pin (!3d…!4d…, most precise),
// the map centre (@lat,lng) or a query (?q=lat,lng).
const PATTERNS = [
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /[?&](?:q|ll|query|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
]

// Only Google's own short links are followed: never fetch an arbitrary URL sent by a user.
const GOOGLE_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|((www|maps)\.)?google\.(com|tn|fr))$/i
const MAX_HOPS = 4

// A café's pin must fall in Tunisia, else the link is wrong.
const inTunisia = ({ lat, lng }: GeoPoint) => lat > 30 && lat < 38 && lng > 7 && lng < 12

export function parseCoords(url: string): GeoPoint | null {
  let text = url
  try {
    text = decodeURIComponent(url)
  } catch {
    // Malformed escapes: search the raw link.
  }
  for (const pattern of PATTERNS) {
    const m = text.match(pattern)
    if (m) {
      const point = { lat: Number(m[1]), lng: Number(m[2]) }
      if (inTunisia(point)) return point
    }
  }
  return null
}

/**
 * The café's position from the manager's Google Maps link. Short links
 * (maps.app.goo.gl) are followed to the full URL. Null when the link has none.
 */
export async function coordsFromMapsUrl(url: string): Promise<GeoPoint | null> {
  if (!url) return null
  let current = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const found = parseCoords(current)
    if (found) return found
    if (hop === MAX_HOPS) break

    let target: URL
    try {
      target = new URL(current)
    } catch {
      return null
    }
    if (target.protocol !== "https:" || !GOOGLE_HOST.test(target.hostname)) return null
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(5_000) })
    const next = res.headers.get("location")
    if (!next) return null
    current = new URL(next, current).toString()
  }
  return null
}

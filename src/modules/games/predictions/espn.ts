// Minimal ESPN client for Barça fixtures (same public API as the mobile app).
export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"
export const BARCA_ESPN_ID = "83"

interface EspnCompetitor {
  homeAway: "home" | "away"
  score?: string | { value?: number }
  team: { id: string; displayName: string; shortDisplayName?: string; abbreviation?: string; logos?: Array<{ href: string }>; logo?: string }
}

interface EspnEvent {
  id: string
  date: string
  league?: { slug?: string; name?: string; shortName?: string }
  status?: { type: { state: "pre" | "in" | "post"; completed?: boolean } }
  competitions: Array<{
    venue?: { fullName?: string }
    status?: { type: { state: "pre" | "in" | "post"; completed?: boolean } }
    competitors: EspnCompetitor[]
  }>
}

export interface EspnFixture {
  espnEventId: string
  kickoff: Date
  competition: string
  venue?: string
  state: "pre" | "in" | "post"
  home: { id: string; name: string; short: string; logo?: string; score?: number }
  away: { id: string; name: string; short: string; logo?: string; score?: number }
}

const COMPETITIONS: Record<string, string> = {
  "esp.1": "LaLiga",
  "uefa.champions": "Ligue des champions",
  "esp.copa_del_rey": "Copa del Rey",
  "esp.super_cup": "Supercopa",
}

const scoreOf = (c: EspnCompetitor): number | undefined => {
  if (typeof c.score === "string") return c.score === "" ? undefined : Number(c.score)
  return c.score?.value
}

const toFixture = (event: EspnEvent): EspnFixture | null => {
  const comp = event.competitions[0]
  const home = comp?.competitors.find((c) => c.homeAway === "home")
  const away = comp?.competitors.find((c) => c.homeAway === "away")
  if (!comp || !home || !away) return null
  const team = (c: EspnCompetitor) => ({
    id: c.team.id,
    name: c.team.shortDisplayName ?? c.team.displayName,
    short: c.team.abbreviation ?? c.team.displayName.slice(0, 3).toUpperCase(),
    logo: c.team.logo ?? c.team.logos?.[0]?.href,
    score: scoreOf(c),
  })
  return {
    espnEventId: event.id,
    kickoff: new Date(event.date),
    competition: (event.league?.slug && COMPETITIONS[event.league.slug]) || event.league?.shortName || "Match",
    venue: comp.venue?.fullName,
    state: (event.status ?? comp.status)?.type.state ?? "pre",
    home: team(home),
    away: team(away),
  }
}

async function fetchSchedule(fixtures: boolean): Promise<EspnFixture[]> {
  const url = `${ESPN_BASE}/all/teams/${BARCA_ESPN_ID}/schedule${fixtures ? "?fixture=true" : ""}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`ESPN ${res.status} sur ${url}`)
  const data = (await res.json()) as { events?: EspnEvent[] }
  return (data.events ?? []).map(toFixture).filter((f): f is EspnFixture => f !== null)
}

/** Upcoming fixtures plus played results, all competitions. */
export async function fetchBarcaFixtures(): Promise<EspnFixture[]> {
  const [upcoming, results] = await Promise.all([fetchSchedule(true), fetchSchedule(false)])
  const byId = new Map<string, EspnFixture>()
  for (const f of [...results, ...upcoming]) byId.set(f.espnEventId, f)
  return [...byId.values()]
}

import { env } from "../config/env.js"

/**
 * Calendar helpers in the app's timezone (Africa/Tunis by default): a "day"
 * for streaks, the daily quiz and leaderboards starts at local midnight.
 */

export type Period = "day" | "week" | "month" | "year"

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number // 0 = Monday … 6 = Sunday
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: env.APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
})

export function zonedParts(date: Date): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of formatter.formatToParts(date)) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  }
}

const offsetMs = (date: Date): number => {
  const p = zonedParts(date)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** UTC instant of local midnight for the given local calendar date. */
export function zonedMidnight(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day)
  return new Date(guess - offsetMs(new Date(guess)))
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "2026-10-15" in the app timezone. */
export function dayKey(date = new Date()): string {
  const p = zonedParts(date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function startOfDay(date = new Date()): Date {
  const p = zonedParts(date)
  return zonedMidnight(p.year, p.month, p.day)
}

export function startOfPeriod(period: Period, date = new Date()): Date {
  const p = zonedParts(date)
  switch (period) {
    case "day":
      return zonedMidnight(p.year, p.month, p.day)
    case "week": {
      // Date.UTC normalises a negative/overflowing day into the right month.
      const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday))
      return zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
    }
    case "month":
      return zonedMidnight(p.year, p.month, 1)
    case "year":
      return zonedMidnight(p.year, 1, 1)
  }
}

/** Key shared by every day of the same week, e.g. "W2026-10-12" (its Monday). */
export function weekKey(date = new Date()): string {
  return `W${dayKey(startOfPeriod("week", date))}`
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/** Day key of the day before `key` ("2026-10-15" → "2026-10-14"). */
export function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`
}

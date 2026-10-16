import { Schema, model } from "mongoose"
import { DEFAULT_SETTINGS } from "./settings.defaults.js"
import { settingsSchema, type LevelDefinition, type Settings } from "./settings.schemas.js"

// One document holds the whole game economy; its shape is validated with Zod.
const settingsDocSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, minimize: false },
)

const SettingsModel = model("Settings", settingsDocSchema)
const KEY = "global"

let cache: Settings | null = null

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Stored values win; fields added since the document was saved come from the defaults. */
function withDefaults(defaults: unknown, stored: unknown): unknown {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) return stored ?? defaults
  const merged: Record<string, unknown> = { ...defaults }
  for (const [key, value] of Object.entries(stored)) merged[key] = withDefaults(defaults[key], value)
  return merged
}

export async function getSettings(): Promise<Settings> {
  if (cache) return cache
  const doc = await SettingsModel.findOne({ key: KEY }).lean()
  if (!doc) {
    await SettingsModel.create({ key: KEY, value: DEFAULT_SETTINGS })
    cache = DEFAULT_SETTINGS
    return cache
  }
  const parsed = settingsSchema.safeParse(withDefaults(DEFAULT_SETTINGS, doc.value))
  cache = parsed.success ? parsed.data : DEFAULT_SETTINGS
  return cache
}

export async function updateSettings(input: unknown): Promise<Settings> {
  const value = settingsSchema.parse(input)
  await SettingsModel.updateOne({ key: KEY }, { value }, { upsert: true })
  cache = value
  return value
}

export interface LevelInfo {
  level: number
  levelName: string
  currentXp: number
  nextLevelXp: number | null
  levelMinXp: number
}

/** Level reached for an XP total, plus progress toward the next one. */
export function levelForXp(xp: number, levels: LevelDefinition[]): LevelInfo {
  let index = 0
  for (let i = 0; i < levels.length; i++) {
    if (xp >= levels[i].minXp) index = i
  }
  const current = levels[index]
  const next = levels[index + 1]
  return {
    level: current.level,
    levelName: current.name,
    levelMinXp: current.minXp,
    currentXp: xp - current.minXp,
    nextLevelXp: next ? next.minXp - current.minXp : null,
  }
}

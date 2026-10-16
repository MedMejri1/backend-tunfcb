import type { RequestHandler } from "express"
import { DEFAULT_SETTINGS } from "./settings.defaults.js"
import { getSettings, updateSettings } from "./settings.service.js"

export const getSettingsHandler: RequestHandler = async (_req, res) => {
  res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS })
}

/** Mobile: public settings the app needs before any game call (ad placements). */
export const appConfigHandler: RequestHandler = async (_req, res) => {
  const { ads } = await getSettings()
  res.json({
    ads: {
      doubleRewards: ads.doubleRewards,
      interstitial: ads.interstitial,
      nativeFeed: ads.nativeFeed,
    },
  })
}

export const updateSettingsHandler: RequestHandler = async (req, res) => {
  res.json({ settings: await updateSettings(req.body) })
}

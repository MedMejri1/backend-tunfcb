import { z } from "zod"

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur hexadécimale attendue (#RRGGBB)")

export const settingsSchema = z.object({
  levels: z
    .array(
      z.object({
        level: z.number().int().min(1),
        name: z.string().trim().min(1).max(40),
        minXp: z.number().int().min(0),
      }),
    )
    .min(1)
    .refine((levels) => levels.every((l, i) => i === 0 || l.minXp > levels[i - 1].minXp), {
      message: "Les seuils d'XP doivent être croissants",
    })
    .refine((levels) => levels[0]?.minXp === 0, { message: "Le premier niveau doit commencer à 0 XP" }),
  streakRewards: z.array(z.number().int().min(0)).length(7, "7 récompenses attendues (une par jour)"),
  quiz: z.object({
    questionsPerQuiz: z.number().int().min(1).max(20),
    pointsPerCorrect: z.number().int().min(0),
    perfectBonus: z.number().int().min(0),
    secondsPerQuestion: z.number().int().min(5).max(120),
  }),
  wheel: z.object({
    cooldownHours: z.number().min(0).max(168),
    segments: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(20),
          points: z.number().int().min(0),
          weight: z.number().min(0),
          color: hexColor,
        }),
      )
      .min(2)
      .max(12)
      .refine((s) => s.some((seg) => seg.weight > 0), { message: "Au moins un segment doit avoir un poids > 0" }),
  }),
  ads: z.object({
    rewardPerAd: z.number().int().min(0),
    maxPerDay: z.number().int().min(0),
    cooldownSeconds: z.number().int().min(0),
    /** "Doubler mes gains" after the quiz and the wheel (rewarded ad). */
    doubleRewards: z.boolean(),
    /** Full-screen ad when the user closes a news article. */
    interstitial: z.object({
      enabled: z.boolean(),
      everyArticles: z.number().int().min(1).max(20),
      minIntervalMinutes: z.number().int().min(0).max(240),
    }),
    /** Sponsored card inside the news list. */
    nativeFeed: z.object({
      enabled: z.boolean(),
      firstPosition: z.number().int().min(1).max(20),
      interval: z.number().int().min(2).max(30),
    }),
  }),
  predictions: z.object({
    exactScorePoints: z.number().int().min(0),
    correctOutcomePoints: z.number().int().min(0),
    closeMinutesBeforeKickoff: z.number().int().min(0),
  }),
  referral: z.object({
    referrerPoints: z.number().int().min(0),
    refereePoints: z.number().int().min(0),
  }),
  /** Amounts in millimes (1 DT = 1000). Closed = "Bientôt disponible" in the app. */
  shop: z.object({
    enabled: z.boolean(),
    shippingFee: z.number().int().min(0),
    freeShippingFrom: z.number().int().min(0),
    maxQuantityPerItem: z.number().int().min(1).max(20),
  }),
})

export type Settings = z.infer<typeof settingsSchema>
export type WheelSegment = Settings["wheel"]["segments"][number]
export type LevelDefinition = Settings["levels"][number]

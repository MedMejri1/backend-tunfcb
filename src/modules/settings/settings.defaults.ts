import type { Settings } from "./settings.schemas.js"

const LEVEL_NAMES = [
  "Nouveau Culé",
  "Culé",
  "Supporter",
  "Supporter Bronze",
  "Supporter Argent",
  "Supporter Or",
  "Ultra",
  "Ultra Platine",
  "Socio",
  "Socio d'Or",
  "Capità",
  "Llegenda",
  "Llegenda d'Or",
  "Mite",
  "Més que un club",
]

const LEVEL_XP = [0, 200, 500, 1000, 1700, 2600, 3700, 5000, 6500, 8200, 10000, 12500, 15500, 19000, 23000]

export const DEFAULT_SETTINGS: Settings = {
  levels: LEVEL_NAMES.map((name, i) => ({ level: i + 1, name, minXp: LEVEL_XP[i] })),
  streakRewards: [10, 15, 20, 25, 30, 40, 100],
  quiz: { questionsPerQuiz: 5, pointsPerCorrect: 10, perfectBonus: 0, secondsPerQuestion: 20 },
  wheel: {
    cooldownHours: 24,
    segments: [
      { label: "10 BP", points: 10, weight: 28, color: "#1E4CAB" },
      { label: "20 BP", points: 20, weight: 24, color: "#A50044" },
      { label: "50 BP", points: 50, weight: 18, color: "#004D98" },
      { label: "Perdu", points: 0, weight: 8, color: "#334155" },
      { label: "100 BP", points: 100, weight: 12, color: "#E11D48" },
      { label: "200 BP", points: 200, weight: 7, color: "#0EA5E9" },
      { label: "500 BP", points: 500, weight: 3, color: "#FFCB05" },
    ],
  },
  ads: {
    rewardPerAd: 20,
    maxPerDay: 8,
    cooldownSeconds: 30,
    doubleRewards: true,
    interstitial: { enabled: true, everyArticles: 3, minIntervalMinutes: 5 },
    nativeFeed: { enabled: true, firstPosition: 3, interval: 6 },
  },
  predictions: { exactScorePoints: 200, correctOutcomePoints: 50, closeMinutesBeforeKickoff: 0 },
  referral: { referrerPoints: 100, refereePoints: 50 },
  shop: { enabled: false, shippingFee: 7000, freeShippingFrom: 0, maxQuantityPerItem: 5 },
  wall: { enabled: true, maxPostsPerDay: 10, autoHideReports: 3 },
  push: {
    matchReminder: { enabled: true, minutesBefore: 5 },
    matchEnd: { enabled: true },
    morning: { enabled: true, time: "10:00" },
    evening: { enabled: true, time: "20:00" },
  },
}

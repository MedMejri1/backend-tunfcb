import type { RequestHandler } from "express"
import { z } from "zod"
import { UserModel } from "../users/user.model.js"
import { presentUser } from "../users/user.service.js"
import { doubleGameReward, getAdsStatus, rewardAd } from "./ads/ads.service.js"
import { claimMission, listMissionsForUser, trackEvent } from "./missions/missions.service.js"
import { listPredictionsForUser, submitPrediction } from "./predictions/predictions.service.js"
import { getTodayQuiz, submitTodayQuiz } from "./quiz/quiz.service.js"
import { claimStreak, getStreakStatus } from "./streak/streak.service.js"
import { getWheelStatus, spinWheel } from "./wheel/wheel.service.js"

/** Re-read the user so the response reflects the balance just credited. */
const freshProfile = async (userId: unknown) => presentUser((await UserModel.findById(userId))!)

export const gamesStatus: RequestHandler = async (req, res) => {
  const user = req.appUser!
  const [profile, streak, quiz, wheel, ads, predictions, missions] = await Promise.all([
    presentUser(user),
    getStreakStatus(user),
    getTodayQuiz(user),
    getWheelStatus(user),
    getAdsStatus(user),
    listPredictionsForUser(user),
    listMissionsForUser(user._id),
  ])
  const nextMatch = predictions.upcoming.find((m) => m.isOpen) ?? null

  res.json({
    profile,
    streak,
    quiz: {
      available: quiz.available,
      questionsCount: quiz.questions.length,
      pointsPerCorrect: quiz.pointsPerCorrect,
      attempt: quiz.attempt,
    },
    wheel,
    ads,
    prediction: {
      rules: predictions.rules,
      nextMatch,
    },
    missions: {
      completedUnclaimed: missions.filter((m) => m.completed && !m.claimed).length,
      total: missions.length,
    },
  })
}

export const claimStreakHandler: RequestHandler = async (req, res) => {
  const result = await claimStreak(req.appUser!)
  res.json({ ...result, profile: await freshProfile(req.appUser!._id) })
}

export const quizToday: RequestHandler = async (req, res) => {
  res.json(await getTodayQuiz(req.appUser!))
}

const quizSubmitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), answerIndex: z.number().int().min(-1).max(3) }))
    .max(20),
})

export const quizSubmit: RequestHandler = async (req, res) => {
  const { answers } = quizSubmitSchema.parse(req.body)
  const result = await submitTodayQuiz(req.appUser!, answers)
  res.json({ ...result, profile: await freshProfile(req.appUser!._id) })
}

export const wheelStatus: RequestHandler = async (req, res) => {
  res.json(await getWheelStatus(req.appUser!))
}

export const wheelSpin: RequestHandler = async (req, res) => {
  const result = await spinWheel(req.appUser!)
  res.json({ ...result, profile: await freshProfile(req.appUser!._id) })
}

export const adsStatus: RequestHandler = async (req, res) => {
  res.json(await getAdsStatus(req.appUser!))
}

export const adsReward: RequestHandler = async (req, res) => {
  const status = await rewardAd(req.appUser!)
  res.json({ ...status, profile: await freshProfile(req.appUser!._id) })
}

const doubleSchema = z.object({ game: z.enum(["quiz", "wheel"]) })

export const doubleReward: RequestHandler = async (req, res) => {
  const { game } = doubleSchema.parse(req.body)
  const result = await doubleGameReward(req.appUser!, game)
  res.json({ ...result, profile: await freshProfile(req.appUser!._id) })
}

export const predictionsList: RequestHandler = async (req, res) => {
  res.json(await listPredictionsForUser(req.appUser!))
}

const predictionSchema = z.object({
  home: z.number().int().min(0).max(20),
  away: z.number().int().min(0).max(20),
})

export const predictionSubmit: RequestHandler = async (req, res) => {
  const { home, away } = predictionSchema.parse(req.body)
  const { created, prediction } = await submitPrediction(req.appUser!, String(req.params.matchId), home, away)
  res.status(created ? 201 : 200).json({
    prediction: { home: prediction.home, away: prediction.away, outcome: prediction.outcome },
  })
}

export const missionsList: RequestHandler = async (req, res) => {
  res.json({ items: await listMissionsForUser(req.appUser!._id) })
}

export const missionClaim: RequestHandler = async (req, res) => {
  await claimMission(req.appUser!._id, String(req.params.id))
  res.json({
    items: await listMissionsForUser(req.appUser!._id),
    profile: await freshProfile(req.appUser!._id),
  })
}

// Only actions the server can't observe itself may be reported by the app.
const CLIENT_EVENTS = ["news_read"] as const

export const missionEvent: RequestHandler = async (req, res) => {
  const { event } = z.object({ event: z.enum(CLIENT_EVENTS) }).parse(req.body)
  await trackEvent(req.appUser!._id, event)
  res.json({ ok: true })
}

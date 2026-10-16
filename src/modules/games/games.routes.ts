import { Router } from "express"
import { requireUser } from "../../middlewares/auth.js"
import {
  adsReward,
  adsStatus,
  claimStreakHandler,
  doubleReward,
  gamesStatus,
  missionClaim,
  missionEvent,
  missionsList,
  predictionsList,
  predictionSubmit,
  quizSubmit,
  quizToday,
  wheelSpin,
  wheelStatus,
} from "./games.controller.js"

const router = Router()
router.use(requireUser)

router.get("/status", gamesStatus)
router.post("/streak/claim", claimStreakHandler)
router.get("/quiz/today", quizToday)
router.post("/quiz/today/submit", quizSubmit)
router.get("/wheel", wheelStatus)
router.post("/wheel/spin", wheelSpin)
router.get("/ads", adsStatus)
router.post("/ads/reward", adsReward)
router.post("/double", doubleReward)
router.get("/predictions", predictionsList)
router.post("/predictions/:matchId", predictionSubmit)
router.get("/missions", missionsList)
router.post("/missions/events", missionEvent)
router.post("/missions/:id/claim", missionClaim)

export { router as gamesRouter }

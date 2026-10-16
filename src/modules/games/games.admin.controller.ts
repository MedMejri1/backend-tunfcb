import type { RequestHandler } from "express"
import { Types } from "mongoose"
import { z } from "zod"
import { HttpError } from "../../middlewares/errorHandler.js"
import { dayKey } from "../../utils/dates.js"
import { escapeRegex, paginated, paginationSchema } from "../../utils/pagination.js"
import { MISSION_EVENTS, MissionModel } from "./missions/mission.model.js"
import { PredictionMatchModel, PredictionModel } from "./predictions/prediction.model.js"
import { cancelMatch, settleMatch, syncPredictionMatches } from "./predictions/predictions.service.js"
import { DailyQuizModel, QuizAttemptModel, QuizQuestionModel, detectLanguage } from "./quiz/quiz.model.js"

// ---------------------------------------------------------------- Quiz

const questionSchema = z
  .object({
    question: z.string().trim().min(5, "question trop courte (5 caractères minimum)").max(300, "question trop longue (300 caractères maximum)"),
    options: z
      .array(z.string().trim().min(1, "réponse vide").max(120, "réponse trop longue (120 caractères maximum)"))
      .min(2, "au moins 2 réponses")
      .max(4, "4 réponses maximum"),
    correctIndex: z.number("bonne réponse manquante").int().min(0),
    category: z.string().trim().min(1).max(40, "catégorie trop longue").default("histoire"),
    difficulty: z.enum(["easy", "medium", "hard"], "difficulté invalide").default("medium"),
    active: z.boolean().default(true),
  })
  .refine((q) => q.correctIndex < q.options.length, {
    message: "La bonne réponse doit être l'une des options",
    path: ["correctIndex"],
  })

const presentQuestion = (q: {
  _id: unknown
  question: string
  options: string[]
  correctIndex: number
  category: string
  difficulty: string
  language?: string | null
  active: boolean
  timesAsked: number
  timesCorrect: number
  createdAt: Date
}) => ({
  id: String(q._id),
  question: q.question,
  options: q.options,
  correctIndex: q.correctIndex,
  category: q.category,
  difficulty: q.difficulty,
  language: q.language ?? "fr",
  active: q.active,
  timesAsked: q.timesAsked,
  successRate: q.timesAsked ? Math.round((q.timesCorrect / q.timesAsked) * 100) : null,
  createdAt: q.createdAt,
})

const questionListSchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
  active: z.enum(["true", "false"]).optional(),
  language: z.enum(["fr", "ar"]).optional(),
})

export const listQuestions: RequestHandler = async (req, res) => {
  const q = questionListSchema.parse(req.query)
  const filter: Record<string, unknown> = {}
  if (q.search) filter.question = new RegExp(escapeRegex(q.search), "i")
  if (q.category) filter.category = q.category
  if (q.active) filter.active = q.active === "true"
  // Older questions have no language field: they are French.
  if (q.language) filter.language = q.language === "fr" ? { $ne: "ar" } : "ar"

  const [items, total, categories] = await Promise.all([
    QuizQuestionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    QuizQuestionModel.countDocuments(filter),
    QuizQuestionModel.distinct("category"),
  ])
  res.json({ ...paginated(items.map(presentQuestion), total, q.page, q.limit), categories })
}

export const createQuestion: RequestHandler = async (req, res) => {
  const input = questionSchema.parse(req.body)
  const question = await QuizQuestionModel.create({ ...input, language: detectLanguage(input.question, input.options) })
  res.status(201).json({ question: presentQuestion(question.toObject()) })
}

export const updateQuestion: RequestHandler = async (req, res) => {
  const input = questionSchema.parse(req.body)
  const question = await QuizQuestionModel.findByIdAndUpdate(
    req.params.id,
    { ...input, language: detectLanguage(input.question, input.options) },
    {
      returnDocument: "after",
    },
  ).lean()
  if (!question) throw new HttpError(404, "Question introuvable")
  res.json({ question: presentQuestion(question) })
}

// Same text (case, spaces and accents ignored) = duplicate.
const normalizeQuestion = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064B-\u065F]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

const importSchema = z.object({
  questions: z.array(z.unknown()).min(1, "Le fichier ne contient aucune question").max(500, "500 questions maximum par import"),
  // true = only check the rows (preview), nothing is saved.
  dryRun: z.boolean().default(false),
})

/**
 * Bulk import from the Excel template. Every row is checked on its own:
 * valid rows are imported, invalid rows and duplicates are reported by index.
 */
export const importQuestions: RequestHandler = async (req, res) => {
  const { questions, dryRun } = importSchema.parse(req.body)
  const existing = new Set(
    (await QuizQuestionModel.find().select("question").lean()).map((q) => normalizeQuestion(q.question)),
  )
  const seen = new Set<string>()

  const rows = questions.map((raw, index) => {
    const parsed = questionSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { index, status: "invalid" as const, error: issue.message.charAt(0).toUpperCase() + issue.message.slice(1) }
    }
    const key = normalizeQuestion(parsed.data.question)
    if (existing.has(key)) return { index, status: "duplicate" as const, error: "Question déjà présente dans la base" }
    if (seen.has(key)) return { index, status: "duplicate" as const, error: "Question en double dans le fichier" }
    seen.add(key)
    const language = detectLanguage(parsed.data.question, parsed.data.options)
    return { index, status: "ok" as const, language, data: { ...parsed.data, language } }
  })

  const valid = rows.flatMap((r) => (r.status === "ok" ? [r.data] : []))
  if (!dryRun && valid.length) await QuizQuestionModel.insertMany(valid)

  res.json({
    dryRun,
    created: dryRun ? 0 : valid.length,
    valid: valid.length,
    rows: rows.map(({ index, status, ...rest }) => ({
      index,
      status,
      ...("error" in rest ? { error: rest.error } : { language: rest.language }),
    })),
  })
}

export const deleteQuestion: RequestHandler = async (req, res) => {
  // Questions already played stay referenced by attempts: deactivate instead.
  const used = await QuizAttemptModel.exists({ "answers.question": req.params.id })
  if (used) {
    await QuizQuestionModel.updateOne({ _id: req.params.id }, { active: false })
    res.json({ ok: true, deactivated: true })
    return
  }
  const deleted = await QuizQuestionModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Question introuvable")
  res.json({ ok: true, deactivated: false })
}

export const quizStats: RequestHandler = async (_req, res) => {
  const today = dayKey()
  const [activeQuestions, totalQuestions, todayQuiz, perDay] = await Promise.all([
    QuizQuestionModel.countDocuments({ active: true }),
    QuizQuestionModel.countDocuments(),
    DailyQuizModel.findOne({ dayKey: today }).populate<{ questions: Array<{ _id: unknown; question: string }> }>(
      "questions",
      "question",
    ),
    QuizAttemptModel.aggregate<{ _id: string; players: number; avgCorrect: number; perfect: number }>([
      { $group: {
          _id: "$dayKey",
          players: { $sum: 1 },
          avgCorrect: { $avg: { $divide: ["$correctCount", { $max: ["$total", 1] }] } },
          perfect: { $sum: { $cond: [{ $eq: ["$correctCount", "$total"] }, 1, 0] } },
        } },
      { $sort: { _id: -1 } },
      { $limit: 14 },
    ]),
  ])
  res.json({
    activeQuestions,
    totalQuestions,
    today: {
      dayKey: today,
      questions: todayQuiz?.questions.map((q) => ({ id: String(q._id), question: q.question })) ?? [],
      players: perDay.find((d) => d._id === today)?.players ?? 0,
    },
    history: perDay.map((d) => ({
      dayKey: d._id,
      players: d.players,
      accuracy: Math.round(d.avgCorrect * 100),
      perfect: d.perfect,
    })),
  })
}

// ---------------------------------------------------------------- Missions

const missionSchema = z.object({
  scope: z.enum(["daily", "weekly"]),
  event: z.enum(MISSION_EVENTS),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(200).default(""),
  icon: z.string().trim().min(1).max(40).default("flag"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#FFCB05"),
  target: z.number().int().min(1).max(1000),
  reward: z.number().int().min(0).max(100_000),
  active: z.boolean().default(true),
  order: z.number().int().default(0),
})

export const listMissions: RequestHandler = async (_req, res) => {
  const missions = await MissionModel.find().sort({ scope: 1, order: 1, createdAt: 1 }).lean()
  res.json({ items: missions.map((m) => ({ ...m, id: String(m._id), _id: undefined })), events: MISSION_EVENTS })
}

export const createMission: RequestHandler = async (req, res) => {
  const mission = await MissionModel.create(missionSchema.parse(req.body))
  res.status(201).json({ id: String(mission._id) })
}

export const updateMission: RequestHandler = async (req, res) => {
  const mission = await MissionModel.findByIdAndUpdate(req.params.id, missionSchema.parse(req.body), {
    returnDocument: "after",
  })
  if (!mission) throw new HttpError(404, "Mission introuvable")
  res.json({ ok: true })
}

export const deleteMission: RequestHandler = async (req, res) => {
  const deleted = await MissionModel.findByIdAndDelete(req.params.id)
  if (!deleted) throw new HttpError(404, "Mission introuvable")
  res.json({ ok: true })
}

// ---------------------------------------------------------------- Predictions

export const listPredictionMatches: RequestHandler = async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query)
  const status = z.enum(["open", "closed", "settled", "cancelled"]).optional().parse(req.query.status || undefined)
  const filter = status ? { status } : {}
  const [items, total] = await Promise.all([
    PredictionMatchModel.find(filter)
      .sort({ kickoff: status === "settled" ? -1 : 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PredictionMatchModel.countDocuments(filter),
  ])
  res.json(paginated(items.map((m) => ({ ...m, id: String(m._id), _id: undefined })), total, page, limit))
}

const teamSchema = z.object({
  name: z.string().trim().min(2).max(60),
  short: z.string().trim().min(2).max(5).toUpperCase(),
  logo: z.string().url().optional(),
})

const manualMatchSchema = z.object({
  competition: z.string().trim().min(2).max(60),
  home: teamSchema,
  away: teamSchema,
  kickoff: z.coerce.date().refine((d) => d.getTime() > Date.now(), { message: "Le coup d'envoi doit être dans le futur" }),
  venue: z.string().trim().max(80).optional(),
})

export const createPredictionMatch: RequestHandler = async (req, res) => {
  const match = await PredictionMatchModel.create(manualMatchSchema.parse(req.body))
  res.status(201).json({ id: String(match._id) })
}

const scoreSchema = z.object({ home: z.number().int().min(0).max(30), away: z.number().int().min(0).max(30) })

export const settlePredictionMatch: RequestHandler = async (req, res) => {
  const result = await settleMatch(String(req.params.id), scoreSchema.parse(req.body))
  res.json({ settled: result.settled, winners: result.winners })
}

export const cancelPredictionMatch: RequestHandler = async (req, res) => {
  await cancelMatch(String(req.params.id))
  res.json({ ok: true })
}

export const syncPredictions: RequestHandler = async (_req, res) => {
  res.json(await syncPredictionMatches())
}

export const listMatchPredictions: RequestHandler = async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw new HttpError(400, "Identifiant invalide")
  const { page, limit } = paginationSchema.parse(req.query)
  const filter = { match: req.params.id }
  const [items, total, distribution] = await Promise.all([
    PredictionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate<{ user: { _id: unknown; firstName: string; lastName?: string; username: string } | null }>(
        "user",
        "firstName lastName username",
      )
      .lean(),
    PredictionModel.countDocuments(filter),
    PredictionModel.aggregate<{ _id: { home: number; away: number }; count: number }>([
      { $match: { match: new Types.ObjectId(String(req.params.id)) } },
      { $group: { _id: { home: "$home", away: "$away" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ])
  res.json({
    ...paginated(
      items.map((p) => ({
        id: String(p._id),
        home: p.home,
        away: p.away,
        outcome: p.outcome,
        pointsAwarded: p.pointsAwarded,
        createdAt: p.createdAt,
        user: p.user
          ? { id: String(p.user._id), name: [p.user.firstName, p.user.lastName].filter(Boolean).join(" "), username: p.user.username }
          : null,
      })),
      total,
      page,
      limit,
    ),
    topScores: distribution.map((d) => ({ score: `${d._id.home}-${d._id.away}`, count: d.count })),
  })
}

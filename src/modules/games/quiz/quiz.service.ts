import { Types } from "mongoose"
import { HttpError } from "../../../middlewares/errorHandler.js"
import { dayKey } from "../../../utils/dates.js"
import { seededShuffle } from "../../../utils/random.js"
import { awardPoints } from "../../points/points.service.js"
import { getSettings } from "../../settings/settings.service.js"
import type { UserDocument } from "../../users/user.model.js"
import { trackEventSafe } from "../missions/missions.service.js"
import { DailyQuizModel, QuizAttemptModel, QuizQuestionModel } from "./quiz.model.js"

async function getOrCreateDailyQuiz(key: string) {
  const existing = await DailyQuizModel.findOne({ dayKey: key })
  if (existing) return existing

  const { quiz } = await getSettings()
  const ids = (await QuizQuestionModel.find({ active: true }).select("_id").sort({ _id: 1 }).lean()).map(
    (q) => q._id,
  )
  const picked = seededShuffle(ids, `quiz-${key}`).slice(0, quiz.questionsPerQuiz)
  try {
    return await DailyQuizModel.create({ dayKey: key, questions: picked })
  } catch (err) {
    // Another request created it at the same time.
    if ((err as { code?: number }).code === 11000) return (await DailyQuizModel.findOne({ dayKey: key }))!
    throw err
  }
}

export async function getTodayQuiz(user: UserDocument) {
  const key = dayKey()
  const { quiz } = await getSettings()
  const attempt = await QuizAttemptModel.findOne({ user: user._id, dayKey: key }).lean()

  const base = {
    dayKey: key,
    secondsPerQuestion: quiz.secondsPerQuestion,
    pointsPerCorrect: quiz.pointsPerCorrect,
    perfectBonus: quiz.perfectBonus,
  }

  if (attempt) {
    return {
      ...base,
      available: false,
      attempt: {
        correctCount: attempt.correctCount,
        total: attempt.total,
        pointsAwarded: attempt.pointsAwarded,
        doubled: !!attempt.doubledAt,
      },
      questions: [],
    }
  }

  const daily = await getOrCreateDailyQuiz(key)
  const questions = await QuizQuestionModel.find({ _id: { $in: daily.questions } }).lean()
  // Keep the daily order; never send the correct answer to the client.
  const ordered = daily.questions
    .map((id) => questions.find((q) => q._id.equals(id)))
    .filter((q): q is NonNullable<typeof q> => !!q)
    .map((q) => ({
      id: String(q._id),
      question: q.question,
      options: q.options,
      category: q.category,
      language: q.language ?? "fr",
    }))

  return { ...base, available: ordered.length > 0, attempt: null, questions: ordered }
}

export async function submitTodayQuiz(
  user: UserDocument,
  answers: Array<{ questionId: string; answerIndex: number }>,
) {
  const key = dayKey()
  if (await QuizAttemptModel.exists({ user: user._id, dayKey: key })) {
    throw new HttpError(409, "Tu as déjà joué au quiz aujourd'hui")
  }

  const daily = await DailyQuizModel.findOne({ dayKey: key })
  if (!daily || daily.questions.length === 0) throw new HttpError(400, "Aucun quiz disponible aujourd'hui")

  const questions = await QuizQuestionModel.find({ _id: { $in: daily.questions } }).lean()
  const results = daily.questions.map((id) => {
    const question = questions.find((q) => q._id.equals(id))
    const answer = answers.find((a) => a.questionId === String(id))
    const answerIndex = answer?.answerIndex ?? -1
    const correct = !!question && answerIndex === question.correctIndex
    return { question: id, answerIndex, correct, correctIndex: question?.correctIndex ?? -1 }
  })

  const correctCount = results.filter((r) => r.correct).length
  const total = results.length
  const perfect = correctCount === total
  const { quiz } = await getSettings()
  const points = correctCount * quiz.pointsPerCorrect + (perfect ? quiz.perfectBonus : 0)

  let attempt
  try {
    attempt = await QuizAttemptModel.create({
      user: user._id,
      dayKey: key,
      answers: results.map(({ question, answerIndex, correct }) => ({ question, answerIndex, correct })),
      correctCount,
      total,
      pointsAwarded: points,
    })
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new HttpError(409, "Tu as déjà joué au quiz aujourd'hui")
    throw err
  }

  if (points > 0) {
    await awardPoints({
      userId: user._id,
      type: "quiz",
      points,
      title: "Quiz du jour",
      detail: `${correctCount}/${total} bonnes réponses`,
      ref: String(attempt._id),
    })
  }

  await QuizQuestionModel.bulkWrite(
    results.map((r) => ({
      updateOne: {
        filter: { _id: r.question as Types.ObjectId },
        update: { $inc: { timesAsked: 1, timesCorrect: r.correct ? 1 : 0 } },
      },
    })),
  )

  trackEventSafe(user._id, "quiz_completed")
  if (perfect) trackEventSafe(user._id, "quiz_perfect")

  return {
    correctCount,
    total,
    points,
    results: results.map((r) => ({
      questionId: String(r.question),
      answerIndex: r.answerIndex,
      correctIndex: r.correctIndex,
      correct: r.correct,
    })),
  }
}

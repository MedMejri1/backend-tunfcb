import { Schema, model, type InferSchemaType, Types } from "mongoose"

const questionSchema = new Schema(
  {
    question: { type: String, required: true, trim: true },
    options: {
      type: [String],
      validate: { validator: (v: string[]) => v.length >= 2 && v.length <= 4, message: "2 à 4 réponses" },
    },
    correctIndex: { type: Number, required: true, min: 0 },
    category: { type: String, default: "histoire", trim: true },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    // Detected from the text: Arabic questions are shown right-to-left in the app.
    language: { type: String, enum: ["fr", "ar"], default: "fr", index: true },
    active: { type: Boolean, default: true, index: true },
    timesAsked: { type: Number, default: 0 },
    timesCorrect: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export type QuizQuestion = InferSchemaType<typeof questionSchema>
export type QuizLanguage = "fr" | "ar"

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/

/** Arabic as soon as the question or an answer contains Arabic letters. */
export const detectLanguage = (question: string, options: string[] = []): QuizLanguage =>
  [question, ...options].some((t) => ARABIC.test(t)) ? "ar" : "fr"
export const QuizQuestionModel = model("QuizQuestion", questionSchema)

// The day's question set, frozen on first request so every user gets the same quiz.
const dailyQuizSchema = new Schema(
  {
    dayKey: { type: String, required: true, unique: true },
    questions: [{ type: Types.ObjectId, ref: "QuizQuestion" }],
  },
  { timestamps: true },
)

export const DailyQuizModel = model("DailyQuiz", dailyQuizSchema)

const attemptSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    dayKey: { type: String, required: true },
    answers: [
      {
        _id: false,
        question: { type: Types.ObjectId, ref: "QuizQuestion" },
        answerIndex: Number,
        correct: Boolean,
      },
    ],
    correctCount: { type: Number, required: true },
    total: { type: Number, required: true },
    pointsAwarded: { type: Number, default: 0 },
    // Set when the points were doubled with a rewarded ad (once per attempt).
    doubledAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

attemptSchema.index({ user: 1, dayKey: 1 }, { unique: true })
attemptSchema.index({ dayKey: 1 })

export const QuizAttemptModel = model("QuizAttempt", attemptSchema)

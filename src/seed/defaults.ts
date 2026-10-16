import { seededShuffle } from "../utils/random.js"
import { seedSuperAdmin } from "../modules/admins/admin.controller.js"
import { MissionModel } from "../modules/games/missions/mission.model.js"
import { DEFAULT_MISSIONS } from "../modules/games/missions/missions.defaults.js"
import { QuizQuestionModel } from "../modules/games/quiz/quiz.model.js"
import { DEFAULT_QUESTIONS } from "../modules/games/quiz/quiz.defaults.js"
import { getSettings } from "../modules/settings/settings.service.js"

/** First-run data: super admin, game settings, missions and quiz questions. */
export async function seedDefaults(): Promise<void> {
  await seedSuperAdmin()
  await getSettings()

  if (!(await MissionModel.exists({}))) {
    await MissionModel.insertMany(DEFAULT_MISSIONS)
    console.log(`[seed] ${DEFAULT_MISSIONS.length} missions créées`)
  }

  if (!(await QuizQuestionModel.exists({}))) {
    await QuizQuestionModel.insertMany(
      DEFAULT_QUESTIONS.map((q) => {
        const options = seededShuffle(q.options, q.question)
        return { ...q, options, correctIndex: options.indexOf(q.options[0]) }
      }),
    )
    console.log(`[seed] ${DEFAULT_QUESTIONS.length} questions de quiz créées`)
  }
}

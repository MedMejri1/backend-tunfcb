/**
 * Demo data for the dashboard: fans with 30 days of game activity.
 *   npm run seed:demo            → add 40 demo users
 *   npm run seed:demo -- --clear → remove every demo user and their data
 */
import bcrypt from "bcryptjs"
import { Types } from "mongoose"
import { connectDB, disconnectDB } from "../config/db.js"
import { seededRandom } from "../utils/random.js"
import { addDays } from "../utils/dates.js"
import { getSettings, levelForXp } from "../modules/settings/settings.service.js"
import { TransactionModel } from "../modules/points/transaction.model.js"
import { UserModel } from "../modules/users/user.model.js"
import { generateReferralCode } from "../modules/users/user.service.js"

const FIRST = ["Mohamed", "Ahmed", "Yassine", "Aymen", "Oussama", "Rania", "Mariem", "Ines", "Skander", "Hamza", "Nour", "Khalil", "Yosra", "Firas", "Amira", "Wassim", "Sami", "Malek", "Eya", "Bilel"]
const LAST = ["Ben Ali", "Trabelsi", "Gharbi", "Jaziri", "Hammami", "Mejri", "Bouazizi", "Chaabane", "Ayari", "Sassi", "Dridi", "Khelifi", "Mansouri", "Zouari", "Ferchichi"]
const PLACES: Array<[string, string]> = [
  ["Tunis", "TN"], ["Sfax", "TN"], ["Sousse", "TN"], ["Bizerte", "TN"], ["Nabeul", "TN"], ["Monastir", "TN"],
  ["Ariana", "TN"], ["Kairouan", "TN"], ["Gabès", "TN"], ["Alger", "DZ"], ["Casablanca", "MA"], ["Paris", "FR"],
]

async function clear() {
  const ids = await UserModel.find({ isDemo: true }).distinct("_id")
  await TransactionModel.deleteMany({ user: { $in: ids } })
  await UserModel.deleteMany({ _id: { $in: ids } })
  console.log(`[demo] ${ids.length} utilisateurs de démo supprimés`)
}

async function seed(count: number) {
  const rand = seededRandom(`demo-${Date.now()}`)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
  const { levels, streakRewards } = await getSettings()
  const passwordHash = await bcrypt.hash("demo-password", 10)
  const now = Date.now()

  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST)
    const lastName = pick(LAST)
    const [city, country] = pick(PLACES)
    const userId = new Types.ObjectId()
    const createdAt = new Date(now - Math.floor(rand() * 60) * 86_400_000 - Math.floor(rand() * 86_400_000))
    // Engagement varies a lot between fans.
    const engagement = rand()
    const transactions: Array<Record<string, unknown>> = []
    let balance = 0

    const add = (type: string, points: number, title: string, at: Date) => {
      if (points <= 0) return
      balance += points
      transactions.push({ user: userId, type, points, balanceAfter: balance, title, createdAt: at })
    }

    for (let d = 29; d >= 0; d--) {
      const day = addDays(new Date(now), -d)
      if (day < createdAt || rand() > engagement) continue
      const at = (h: number) => new Date(day.getTime() - (day.getTime() % 86_400_000) + h * 3_600_000 + Math.floor(rand() * 3_600_000))
      add("streak", streakRewards[Math.floor(rand() * 7)], "Bonus quotidien", at(8))
      if (rand() < 0.8) add("quiz", Math.floor(rand() * 6) * 10, "Quiz du jour", at(12))
      if (rand() < 0.6) add("wheel", pick([10, 20, 20, 50, 50, 100, 200]), "Roue de la chance", at(18))
      for (let k = 0; k < Math.floor(rand() * 4); k++) add("ad", 20, "Publicité regardée", at(19 + k))
      if (rand() < 0.15) add("prediction", pick([50, 50, 200]), "Bon pronostic", at(22))
      if (rand() < 0.3) add("mission", pick([25, 30, 40, 50]), "Mission du jour", at(21))
    }

    const streakNow = Math.floor(rand() * 7)
    const lastActiveAt = transactions.length ? (transactions[transactions.length - 1].createdAt as Date) : createdAt
    await UserModel.collection.insertOne({
      _id: userId,
      firstName,
      lastName,
      username: `${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/g, "") + Math.floor(rand() * 900 + 100),
      email: `demo.${userId.toHexString()}@demo.barca.app`,
      passwordHash,
      city,
      country,
      status: rand() < 0.04 ? "banned" : "active",
      balance,
      xp: balance,
      level: levelForXp(balance, levels).level,
      streak: { current: streakNow, best: Math.max(streakNow, Math.floor(rand() * 20)) },
      games: { adsCount: 0 },
      referralCode: await generateReferralCode(),
      referralsCount: 0,
      lastActiveAt,
      lastLoginAt: lastActiveAt,
      isDemo: true,
      createdAt,
      updatedAt: lastActiveAt,
    })
    if (transactions.length) await TransactionModel.collection.insertMany(transactions)
  }
  console.log(`[demo] ${count} utilisateurs de démo créés avec leur activité`)
}

await connectDB()
try {
  if (process.argv.includes("--clear")) await clear()
  else await seed(40)
} finally {
  await disconnectDB()
}

import { createServer } from "node:http"
import { createApp } from "./app.js"
import { env } from "./config/env.js"
import { connectDB, disconnectDB } from "./config/db.js"
import { seedDefaults } from "./seed/defaults.js"
import { startPredictionSync } from "./modules/games/predictions/predictions.service.js"

async function bootstrap() {
  await connectDB()
  await seedDefaults()

  const server = createServer(createApp())

  server.listen(env.PORT, () => {
    console.log(`[server] API prête → http://localhost:${env.PORT}/api/health`)
    startPredictionSync(env.PREDICTIONS_SYNC_MINUTES)
  })

  const shutdown = (signal: string) => {
    console.log(`\n[server] ${signal} reçu, arrêt en cours...`)
    server.close(async () => {
      await disconnectDB()
      process.exit(0)
    })
  }

  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

bootstrap().catch((err) => {
  console.error("[server] Échec du démarrage :", err)
  process.exit(1)
})

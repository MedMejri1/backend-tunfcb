import path from "node:path"
import express from "express"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"

import { env } from "./config/env.js"
import { apiRouter } from "./routes/index.js"
import { notFound } from "./middlewares/notFound.js"
import { errorHandler } from "./middlewares/errorHandler.js"

export function createApp() {
  const app = express()

  const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)

  app.set("trust proxy", 1)
  app.use(helmet())
  app.use(
    cors({
      // Native mobile requests carry no Origin header; browsers must be allow-listed.
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
        cb(new Error(`Origine non autorisée : ${origin}`))
      },
    }),
  )
  // A wall post carries up to 3 photos in base64: bigger limit on that route only
  // (the general parser below skips a body that's already been read).
  app.post("/api/wall/posts", express.json({ limit: "8mb" }))
  app.use(express.json({ limit: "1mb" }))

  if (env.NODE_ENV !== "test") {
    app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"))
  }

  // Product photos: readable from the app and the dashboard (another origin in dev).
  app.use(
    "/api/uploads",
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
      next()
    },
    express.static(path.resolve(env.UPLOAD_DIR), { maxAge: "7d", fallthrough: false }),
  )

  app.use("/api", apiRouter)

  app.use(notFound)
  app.use(errorHandler)

  return app
}

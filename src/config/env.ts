import "dotenv/config"
import { z } from "zod"

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI est requis"),
  // Optional DNS servers (comma separated) for mongodb+srv:// lookups: on some
  // Windows setups Node queries 127.0.0.1, which refuses SRV requests.
  DNS_SERVERS: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET doit faire au moins 32 caractères"),
  JWT_EXPIRES_IN: z.string().default("30d"),
  ADMIN_JWT_SECRET: z.string().min(32, "ADMIN_JWT_SECRET doit faire au moins 32 caractères"),
  ADMIN_JWT_EXPIRES_IN: z.string().default("12h"),
  SUPER_ADMIN_EMAIL: z.string().email().default("admin@barca.app"),
  SUPER_ADMIN_PASSWORD: z.string().min(8),
  APP_TIMEZONE: z.string().default("Africa/Tunis"),
  PREDICTIONS_SYNC_MINUTES: z.coerce.number().int().min(0).default(30),
  // Optional: required by Expo only if "enhanced push security" is turned on for the project.
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Set to "false" to stop this instance from sending the automatic pushes.
  PUSH_SCHEDULER: z.enum(["true", "false"]).default("true"),
  // Product photos uploaded from the dashboard (served under /api/uploads).
  UPLOAD_DIR: z.string().default("uploads"),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error("Configuration .env invalide :", z.flattenError(parsed.error).fieldErrors)
  process.exit(1)
}

export const env = parsed.data

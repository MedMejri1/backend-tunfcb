import dns from "node:dns"
import mongoose from "mongoose"
import { env } from "./env.js"

export async function connectDB(): Promise<void> {
  mongoose.set("strictQuery", true)

  const dnsServers = env.DNS_SERVERS?.split(",").map((s) => s.trim()).filter(Boolean)
  if (dnsServers?.length) dns.setServers(dnsServers)

  try {
    await mongoose.connect(env.MONGODB_URI)
    const { host, name } = mongoose.connection
    console.log(`[db] MongoDB connecté → ${host}/${name}`)
  } catch (err) {
    console.error("[db] Échec de connexion à MongoDB :", err)
    process.exit(1)
  }

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] MongoDB déconnecté")
  })

  mongoose.connection.on("error", (err) => {
    console.error("[db] Erreur MongoDB :", err)
  })
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect()
}

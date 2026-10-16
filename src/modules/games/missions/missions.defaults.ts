import type { MissionEvent } from "./mission.model.js"

export const DEFAULT_MISSIONS: Array<{
  scope: "daily" | "weekly"
  event: MissionEvent
  title: string
  description: string
  icon: string
  color: string
  target: number
  reward: number
  order: number
}> = [
  { scope: "daily", event: "news_read", title: "Lire 3 actualités", description: "Consulte 3 articles de l'accueil", icon: "newspaper-outline", color: "#FFCB05", target: 3, reward: 30, order: 1 },
  { scope: "daily", event: "quiz_completed", title: "Faire le quiz", description: "Complète le quiz du jour", icon: "help-circle-outline", color: "#1E4CAB", target: 1, reward: 25, order: 2 },
  { scope: "daily", event: "ad_watched", title: "Regarder 2 publicités", description: "Regarde 2 vidéos publicitaires", icon: "play-circle-outline", color: "#22C55E", target: 2, reward: 40, order: 3 },
  { scope: "daily", event: "prediction_made", title: "Faire un pronostic", description: "Prédis le score d'un match", icon: "trending-up", color: "#E11D48", target: 1, reward: 50, order: 4 },
  { scope: "weekly", event: "streak_claimed", title: "Connexion 7 jours d'affilée", description: "Récupère ton bonus quotidien 7 jours cette semaine", icon: "flame", color: "#F59E0B", target: 7, reward: 300, order: 1 },
  { scope: "weekly", event: "quiz_perfect", title: "Gagner 5 quiz", description: "Termine 5 quiz avec 100% de bonnes réponses", icon: "trophy-outline", color: "#FFCB05", target: 5, reward: 500, order: 2 },
  { scope: "weekly", event: "referral_completed", title: "Inviter 2 amis", description: "Fais valider ton code de parrainage", icon: "people-outline", color: "#1E4CAB", target: 2, reward: 1000, order: 3 },
]

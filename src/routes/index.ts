import express, { Router } from "express"
import mongoose from "mongoose"

import { requireAdmin, requireAdminRole, requireUser } from "../middlewares/auth.js"
import { adminAuthRouter, adminsRouter } from "../modules/admins/admin.routes.js"
import { authRouter } from "../modules/auth/auth.routes.js"
import { gamesRouter } from "../modules/games/games.routes.js"
import * as gamesAdmin from "../modules/games/games.admin.controller.js"
import { adminLeaderboard, appLeaderboard } from "../modules/leaderboard/leaderboard.controller.js"
import * as notifications from "../modules/notifications/notifications.controller.js"
import * as push from "../modules/push/push.controller.js"
import { listTransactions } from "../modules/points/transactions.admin.controller.js"
import { appConfigHandler, getSettingsHandler, updateSettingsHandler } from "../modules/settings/settings.controller.js"
import * as shopAdmin from "../modules/shop/shop.admin.controller.js"
import * as shop from "../modules/shop/shop.controller.js"
import * as support from "../modules/support/support.controller.js"
import * as team from "../modules/team/team.controller.js"
import { overview } from "../modules/stats/stats.controller.js"
import * as usersAdmin from "../modules/users/user.admin.controller.js"
import { myReferrals, myStats, myTransactions } from "../modules/users/user.controller.js"

const router = Router()

const dbStates: Record<number, string> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
}

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    db: dbStates[mongoose.connection.readyState] ?? "unknown",
    timestamp: new Date().toISOString(),
  })
})

// ------------------------------------------------------------ Mobile app

router.get("/app/config", appConfigHandler)
router.use("/auth", authRouter)
router.use("/games", gamesRouter)
router.get("/leaderboard", requireUser, appLeaderboard)
router.get("/me/transactions", requireUser, myTransactions)
router.get("/me/referrals", requireUser, myReferrals)
router.get("/me/stats", requireUser, myStats)
router.get("/notifications", requireUser, notifications.myNotifications)
router.post("/notifications/read-all", requireUser, notifications.markAllRead)
router.put("/me/push-token", requireUser, push.savePushToken)
router.delete("/me/push-token", requireUser, push.deletePushToken)
router.patch("/me/notification-prefs", requireUser, push.updateNotificationPrefs)
router.get("/shop", requireUser, shop.getShop)
router.get("/shop/products/:id", requireUser, shop.getProduct)
router.post("/shop/orders", requireUser, shop.placeOrder)
router.get("/shop/orders", requireUser, shop.myOrders)
router.get("/shop/orders/:id", requireUser, shop.myOrder)
router.post("/shop/orders/:id/cancel", requireUser, shop.cancelMyOrder)
router.get("/team/injuries", requireUser, team.teamInjuries)
router.get("/support", requireUser, support.myTickets)
router.post("/support", requireUser, support.createMyTicket)
router.get("/support/:id", requireUser, support.myTicket)
router.post("/support/:id/messages", requireUser, support.replyToMyTicket)

// ------------------------------------------------------------ Admin dashboard

router.use("/admin/auth", adminAuthRouter)

const admin = Router()
admin.use(requireAdmin)
const superAdmin = requireAdminRole("super_admin")

admin.use("/admins", adminsRouter)
admin.get("/stats/overview", overview)

admin.get("/users", usersAdmin.listUsers)
admin.get("/users/:id", usersAdmin.getUser)
admin.patch("/users/:id", usersAdmin.updateUser)
admin.post("/users/:id/status", usersAdmin.setUserStatus)
admin.post("/users/:id/points", usersAdmin.adjustUserPoints)
admin.post("/users/:id/password", usersAdmin.resetUserPassword)
admin.delete("/users/:id", superAdmin, usersAdmin.deleteUser)

admin.get("/transactions", listTransactions)
admin.get("/leaderboard", adminLeaderboard)

admin.get("/settings", getSettingsHandler)
admin.put("/settings", superAdmin, updateSettingsHandler)

admin.get("/quiz/stats", gamesAdmin.quizStats)
admin.get("/quiz/questions", gamesAdmin.listQuestions)
admin.post("/quiz/questions", gamesAdmin.createQuestion)
admin.post("/quiz/questions/import", gamesAdmin.importQuestions)
admin.put("/quiz/questions/:id", gamesAdmin.updateQuestion)
admin.delete("/quiz/questions/:id", gamesAdmin.deleteQuestion)

admin.get("/missions", gamesAdmin.listMissions)
admin.post("/missions", gamesAdmin.createMission)
admin.put("/missions/:id", gamesAdmin.updateMission)
admin.delete("/missions/:id", gamesAdmin.deleteMission)

admin.get("/predictions/matches", gamesAdmin.listPredictionMatches)
admin.post("/predictions/matches", gamesAdmin.createPredictionMatch)
admin.post("/predictions/sync", gamesAdmin.syncPredictions)
admin.get("/predictions/matches/:id/predictions", gamesAdmin.listMatchPredictions)
admin.post("/predictions/matches/:id/settle", gamesAdmin.settlePredictionMatch)
admin.post("/predictions/matches/:id/cancel", gamesAdmin.cancelPredictionMatch)

admin.get("/notifications", notifications.adminListNotifications)
admin.post("/notifications", notifications.adminCreateNotification)
admin.delete("/notifications/:id", notifications.adminDeleteNotification)
admin.get("/push/status", push.adminPushStatus)

admin.get("/shop/summary", shopAdmin.shopSummary)
admin.put("/shop/settings", superAdmin, shopAdmin.updateShopSettings)
admin.get("/shop/products", shopAdmin.listProducts)
admin.post("/shop/products", shopAdmin.createProduct)
admin.patch("/shop/products/:id", shopAdmin.updateProduct)
admin.delete("/shop/products/:id", shopAdmin.deleteProduct)
admin.post(
  "/shop/uploads",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }),
  shopAdmin.uploadProductImage,
)
admin.get("/shop/orders", shopAdmin.listOrders)
admin.get("/shop/orders/:id", shopAdmin.getOrder)
admin.patch("/shop/orders/:id", shopAdmin.updateOrder)
admin.post("/shop/orders/:id/status", shopAdmin.updateOrderStatus)

admin.get("/team/roster", team.adminTeamRoster)
admin.get("/team/injuries", team.adminListInjuries)
admin.post("/team/injuries", team.adminCreateInjury)
admin.patch("/team/injuries/:id", team.adminUpdateInjury)
admin.delete("/team/injuries/:id", team.adminDeleteInjury)

admin.get("/support/summary", support.adminSupportSummary)
admin.get("/support", support.adminListTickets)
admin.get("/support/:id", support.adminTicket)
admin.post("/support/:id/messages", support.adminReply)
admin.post("/support/:id/status", support.adminSetStatus)

router.use("/admin", admin)

export { router as apiRouter }

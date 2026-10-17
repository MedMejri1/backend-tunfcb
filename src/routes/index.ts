import express, { Router } from "express"
import mongoose from "mongoose"

import { optionalUser, requireAdmin, requireAdminRole, requireUser } from "../middlewares/auth.js"
import { rateLimit } from "express-rate-limit"
import { adminAuthRouter, adminsRouter } from "../modules/admins/admin.routes.js"
import { authRouter } from "../modules/auth/auth.routes.js"
import * as cafes from "../modules/cafes/cafes.controller.js"
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
import * as wall from "../modules/wall/wall.controller.js"
import * as wallAdmin from "../modules/wall/wall.admin.controller.js"

const router = Router()

// Guest phones register without an account: calls are capped per IP.
const guestLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de requêtes, réessaie dans quelques minutes" },
})

// Café sign-ups are open to guests: a few per IP and per hour.
const cafeRequestLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Trop de demandes envoyées, réessaie plus tard" },
})

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
// Open to guests (no account): read-only content.
router.get("/leaderboard", optionalUser, appLeaderboard)
router.get("/me/transactions", requireUser, myTransactions)
router.get("/me/referrals", requireUser, myReferrals)
router.get("/me/stats", requireUser, myStats)
router.get("/notifications", requireUser, notifications.myNotifications)
router.post("/notifications/read-all", requireUser, notifications.markAllRead)
router.put("/me/push-token", requireUser, push.savePushToken)
router.delete("/me/push-token", requireUser, push.deletePushToken)
router.patch("/me/notification-prefs", requireUser, push.updateNotificationPrefs)
router.put("/guest/push-token", guestLimiter, push.saveGuestPushToken)
router.delete("/guest/push-token", guestLimiter, push.deleteGuestPushToken)
router.get("/shop", requireUser, shop.getShop)
router.get("/shop/products/:id", requireUser, shop.getProduct)
router.post("/shop/orders", requireUser, shop.placeOrder)
router.get("/shop/orders", requireUser, shop.myOrders)
router.get("/shop/orders/:id", requireUser, shop.myOrder)
router.post("/shop/orders/:id/cancel", requireUser, shop.cancelMyOrder)
router.get("/team/injuries", team.teamInjuries)
// Cafés showing the matches: open to guests (a café manager may have no account).
router.get("/cafes/locations", cafes.cafeLocations)
router.get("/cafes", cafes.listCafes)
router.post("/cafes", cafeRequestLimiter, optionalUser, cafes.submitCafe)
router.get("/support", requireUser, support.myTickets)
router.post("/support", requireUser, support.createMyTicket)
router.get("/support/:id", requireUser, support.myTicket)
router.post("/support/:id/messages", requireUser, support.replyToMyTicket)
// Fans' wall. Photos are public (an <Image> can't send the token).
router.get("/wall/images/:id", wall.image)
router.get("/wall/posts", requireUser, wall.feed)
router.post("/wall/posts", requireUser, wall.publish)
router.get("/wall/posts/:id", requireUser, wall.post)
router.delete("/wall/posts/:id", requireUser, wall.removePost)
router.put("/wall/posts/:id/reaction", requireUser, wall.react)
router.delete("/wall/posts/:id/reaction", requireUser, wall.unreact)
router.get("/wall/posts/:id/comments", requireUser, wall.comments)
router.post("/wall/posts/:id/comments", requireUser, wall.comment)
router.post("/wall/posts/:id/report", requireUser, wall.reportPost)
router.delete("/wall/comments/:id", requireUser, wall.removeComment)
router.post("/wall/comments/:id/report", requireUser, wall.reportComment)

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

admin.get("/cafes/summary", cafes.adminCafesSummary)
admin.get("/cafes", cafes.adminListCafes)
admin.post("/cafes", cafes.adminCreateCafe)
admin.patch("/cafes/:id", cafes.adminUpdateCafe)
admin.post("/cafes/:id/status", cafes.adminSetCafeStatus)
admin.delete("/cafes/:id", cafes.adminDeleteCafe)

admin.get("/support/summary", support.adminSupportSummary)
admin.get("/support", support.adminListTickets)
admin.get("/support/:id", support.adminTicket)
admin.post("/support/:id/messages", support.adminReply)
admin.post("/support/:id/status", support.adminSetStatus)

admin.get("/wall/summary", wallAdmin.wallSummary)
admin.put("/wall/settings", superAdmin, wallAdmin.updateWallSettings)
admin.get("/wall/posts", wallAdmin.listPosts)
admin.get("/wall/posts/:id", wallAdmin.getPost)
admin.post("/wall/posts/:id/moderate", wallAdmin.moderatePostHandler)
admin.delete("/wall/posts/:id", wallAdmin.deletePostHandler)
admin.post("/wall/comments/:id/moderate", wallAdmin.moderateCommentHandler)
admin.delete("/wall/comments/:id", wallAdmin.deleteCommentHandler)
admin.post("/wall/users/:id/block", wallAdmin.blockUser)

router.use("/admin", admin)

export { router as apiRouter }

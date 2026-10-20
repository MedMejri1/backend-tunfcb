import { Schema, model, type HydratedDocument, type InferSchemaType, Types } from "mongoose"

const userSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, default: "", trim: true, maxlength: 60 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Sign-in identifier since 2026-10 (international format, see utils/phone).
    // Absent on the first accounts, created with an email.
    phone: { type: String, trim: true },
    // Optional since 2026-10: never stored empty (unset instead) so the unique index ignores it.
    email: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    city: { type: String, default: "", trim: true },
    country: { type: String, default: "TN", uppercase: true, trim: true },

    status: { type: String, enum: ["active", "banned"], default: "active", index: true },
    banReason: { type: String },
    bannedAt: { type: Date },

    // Spendable points (BP)
    balance: { type: Number, default: 0 },
    // Net points earned (everything except spending): drives the level
    xp: { type: Number, default: 0, index: true },
    level: { type: Number, default: 1 },

    streak: {
      current: { type: Number, default: 0 },
      best: { type: Number, default: 0 },
      lastClaimDay: { type: String },
    },

    // Game cooldown state, updated atomically to block double claims
    games: {
      wheelLastSpinAt: { type: Date },
      adsDay: { type: String },
      adsCount: { type: Number, default: 0 },
      lastAdAt: { type: Date },
    },

    referralCode: { type: String, required: true, unique: true, uppercase: true },
    referredBy: { type: Types.ObjectId, ref: "User" },
    referralsCount: { type: Number, default: 0 },

    // Legacy single device (accounts registered before multi-device): moved into
    // expoPushTokens the next time the app sends its token.
    expoPushToken: { type: String, index: true, sparse: true },
    // Every phone/tablet signed in to the account, newest last (capped in push.controller).
    expoPushTokens: { type: [String], default: undefined, index: true },
    // Automatic pushes the user accepts (dashboard announcements always go out).
    notificationPrefs: {
      matches: { type: Boolean, default: true },
      games: { type: Boolean, default: true },
      // Comments on the supporter's wall posts.
      wall: { type: Boolean, default: true },
    },
    // Can still read the fans' wall but no longer post, comment or react.
    wallBlocked: { type: Boolean, default: false },
    lastNotificationsReadAt: { type: Date },
    lastLoginAt: { type: Date },
    lastActiveAt: { type: Date, index: true },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// Unique when present only: an account may have no email (or, for older ones, no phone).
userSchema.index({ phone: 1 }, { name: "phone_unique", unique: true, partialFilterExpression: { phone: { $type: "string" } } })
userSchema.index({ email: 1 }, { name: "email_unique", unique: true, partialFilterExpression: { email: { $type: "string" } } })
userSchema.index({ createdAt: -1 })
userSchema.index({ country: 1, xp: -1 })

export type User = InferSchemaType<typeof userSchema>
export type UserDocument = HydratedDocument<User>
export const UserModel = model("User", userSchema)

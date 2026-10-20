import { z } from "zod"
import { phoneSchema } from "../../utils/phone.js"

const emailSchema = z.string().trim().toLowerCase().email("Email invalide")

/** Optional email: an empty field means none. */
const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)
  .pipe(emailSchema.optional())

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court").max(80),
  phone: phoneSchema,
  email: optionalEmail,
  password: z.string().min(8, "8 caractères minimum").max(128),
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || undefined),
  city: z.string().trim().max(60).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
})

/**
 * Phone and password since 2026-10. The email still works: the first accounts
 * have no phone, and app versions from before send { email, password }.
 */
export const loginSchema = z
  .object({
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    password: z.string().min(1, "Mot de passe requis"),
  })
  .refine((v) => v.phone || v.email, { message: "Numéro de téléphone requis", path: ["phone"] })

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    city: z.string().trim().max(60).optional(),
    country: z.string().trim().length(2).toUpperCase().optional(),
    expoPushToken: z.string().trim().max(200).optional(),
    // Only to fill in a missing one: changing them goes through the team.
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à mettre à jour" })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "8 caractères minimum").max(128),
})

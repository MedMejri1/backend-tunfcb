import { z } from "zod"

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Nom trop court").max(80),
  email: z.string().trim().toLowerCase().email("Email invalide"),
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

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
})

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    city: z.string().trim().max(60).optional(),
    country: z.string().trim().length(2).toUpperCase().optional(),
    expoPushToken: z.string().trim().max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucun champ à mettre à jour" })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "8 caractères minimum").max(128),
})

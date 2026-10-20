import { z } from "zod"

/**
 * A phone number in international format (E.164), as stored on accounts:
 * "22 123 456", "+216 22 123 456", "0021622123456" → "+21622123456";
 * a number from abroad must start with + or 00 ("+33 6 12 34 56 78" → "+33612345678").
 * Null when it isn't a valid number.
 */
export function normalizePhone(raw: string): string | null {
  let v = raw.replace(/[\s.\-()]/g, "")
  if (v.startsWith("00")) v = `+${v.slice(2)}`
  // Tunisian mobile and landline numbers: 8 digits, never starting with 0 or 1.
  if (/^[2-9]\d{7}$/.test(v)) return `+216${v}`
  if (v.startsWith("+216")) return /^\+216[2-9]\d{7}$/.test(v) ? v : null
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value)
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Numéro de téléphone invalide" })
      return z.NEVER
    }
    return phone
  })

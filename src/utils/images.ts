import { HttpError } from "../middlewares/errorHandler.js"

// Photos sent by the app are resized to 1280 px (~200-400 KB): 1.5 MB leaves room.
export const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024
// Base64 length of a MAX_IMAGE_BYTES photo, for the zod schemas (checked again once decoded).
export const MAX_IMAGE_BASE64 = 2_100_000

const SIGNATURES: Array<[contentType: string, test: (b: Buffer) => boolean]> = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.readUInt32BE(0) === 0x89504e47],
  ["image/webp", (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"],
]

/** Base64 photo, checked by its actual bytes (not a declared type). */
export function decodeImage(base64: string) {
  const data = Buffer.from(base64, "base64")
  const contentType = data.length >= 12 ? SIGNATURES.find(([, test]) => test(data))?.[0] : undefined
  if (!contentType) throw new HttpError(400, "Photo invalide : JPG, PNG ou WebP attendu")
  if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Photo trop lourde (1,5 Mo maximum)")
  return { data, contentType }
}

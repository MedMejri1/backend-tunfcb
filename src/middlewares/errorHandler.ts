import type { ErrorRequestHandler } from "express"
import mongoose from "mongoose"
import { ZodError, z } from "zod"

export class HttpError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Données invalides",
      details: z.flattenError(err).fieldErrors,
    })
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: `Identifiant invalide : ${err.value}` })
    return
  }

  // Duplicate key (unique index)
  if ((err as { code?: number }).code === 11000) {
    const fields = Object.keys((err as { keyValue?: object }).keyValue ?? {})
    res.status(409).json({ error: `Valeur déjà utilisée : ${fields.join(", ")}` })
    return
  }

  console.error("[error]", err)
  res.status(500).json({ error: "Erreur interne du serveur" })
}

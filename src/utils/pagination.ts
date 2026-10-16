import { z } from "zod"

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
}

export function paginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) }
}

/** Escape user input before using it inside a RegExp search. */
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

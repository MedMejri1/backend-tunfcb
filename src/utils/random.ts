import { randomInt } from "node:crypto"

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const rand = seededRandom(seed)
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Index picked with probability proportional to its weight (crypto RNG). */
export function weightedIndex(weights: number[]): number {
  const scaled = weights.map((w) => Math.max(0, Math.round(w * 1000)))
  const total = scaled.reduce((a, b) => a + b, 0)
  let roll = randomInt(total)
  for (let i = 0; i < scaled.length; i++) {
    if (roll < scaled[i]) return i
    roll -= scaled[i]
  }
  return scaled.length - 1
}

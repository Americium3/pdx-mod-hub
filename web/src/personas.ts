import { api } from './api'

// Persona resolution is asynchronous server-side: browse/detail responses carry
// names only when already cached, and the server queues the misses. This helper
// re-asks /api/personas after a view lands so names fill in as the background
// resolver completes. The slow tail outlives the server's 5-minute circuit-
// breaker cooldown (steamcommunity blocked/slow), so a recovered resolver still
// repaints an already-rendered view and re-enqueues ids dropped on failure.
const DELAYS_MS = [4_000, 12_000, 45_000, 5.5 * 60_000]

const ID64 = /^\d{17}$/

export type PersonaMap = Record<string, { name: string; avatarUrl?: string }>

/**
 * Watch unresolved SteamID64s; calls apply() with whatever resolves (plus the
 * server's known-missing list, so callers can settle negatives). Non-ID64
 * values are dropped here so one malformed id can never 400 the whole batch.
 * Returns a cancel fn.
 */
export function watchPersonas(
  ids: Array<string | undefined>,
  apply: (personas: PersonaMap, missing?: string[]) => void,
): () => void {
  const unique = [
    ...new Set(ids.filter((x): x is string => typeof x === 'string' && ID64.test(x))),
  ].slice(0, 100)
  if (unique.length === 0) return () => undefined
  let cancelled = false
  const timers = DELAYS_MS.map(delay =>
    setTimeout(() => {
      api
        .personas(unique)
        .then(res => {
          if (cancelled) return
          const missing = res.missing ?? []
          if (Object.keys(res.personas).length > 0 || missing.length > 0) {
            apply(res.personas, missing)
          }
        })
        .catch(() => undefined)
    }, delay),
  )
  return () => {
    cancelled = true
    timers.forEach(clearTimeout)
  }
}

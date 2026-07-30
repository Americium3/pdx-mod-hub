import { api } from './api'

// Persona resolution is asynchronous server-side: browse/detail responses carry
// names only when already cached, and the server queues the misses. This helper
// re-asks /api/personas a couple of times after a view lands so names fill in
// as the background resolver completes.
const DELAYS_MS = [4_000, 12_000]

export type PersonaMap = Record<string, { name: string; avatarUrl?: string }>

/** Watch unresolved SteamID64s; calls apply() with whatever resolves. Returns a cancel fn. */
export function watchPersonas(
  ids: Array<string | undefined>,
  apply: (personas: PersonaMap) => void,
): () => void {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))].slice(0, 100)
  if (unique.length === 0) return () => undefined
  const timers = DELAYS_MS.map(delay =>
    setTimeout(() => {
      api
        .personas(unique)
        .then(res => {
          if (Object.keys(res.personas).length > 0) apply(res.personas)
        })
        .catch(() => undefined)
    }, delay),
  )
  return () => timers.forEach(clearTimeout)
}

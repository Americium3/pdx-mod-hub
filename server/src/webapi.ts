import type { RemoteFetchStatus } from './types.js'

const ENDPOINT = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
const CHUNK = 100
const TIMEOUT_MS = 8_000

function num(v: unknown): number | undefined {
  const x = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN
  return Number.isFinite(x) ? x : undefined
}

export interface RemoteFetchResult {
  id: string
  status: RemoteFetchStatus
  result: number
  appId?: number
  title?: string
  description?: string
  previewUrl?: string
  fileSize?: number
  timeCreated?: number
  timeUpdated?: number
  subscriptions?: number
  lifetimeSubscriptions?: number
  favorited?: number
  views?: number
  tags?: string[]
  creator?: string
  banned?: boolean
}

// EResult values seen from the keyless endpoint (verified live: bogus ids come
// back as result=9 inside a 200 envelope).
function statusOf(result: number, banned: boolean): RemoteFetchStatus {
  if (result === 1) return banned ? 'banned' : 'ok'
  if (result === 9) return 'removed' // k_EResultFileNotFound
  if (result === 15) return 'private' // k_EResultAccessDenied
  return 'error'
}

/**
 * Keyless batch endpoint, chunked ~100 ids/request, 8s timeout per request.
 * Responses are mapped BY publishedfileid: an id missing from the returned map
 * is a transport gap and must leave the caller's state untouched (never treated
 * as removal). A failed chunk throws — the whole poll counts as failed and no
 * partial statuses are applied.
 */
export async function fetchPublishedFileDetails(
  ids: string[],
): Promise<Map<string, RemoteFetchResult>> {
  const out = new Map<string, RemoteFetchResult>()
  for (let ofs = 0; ofs < ids.length; ofs += CHUNK) {
    const chunk = ids.slice(ofs, ofs + CHUNK)
    const body = new URLSearchParams()
    body.set('itemcount', String(chunk.length))
    chunk.forEach((id, i) => body.set(`publishedfileids[${i}]`, id))
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`GetPublishedFileDetails HTTP ${res.status}`)
    const json = (await res.json()) as {
      response?: { publishedfiledetails?: Array<Record<string, unknown>> }
    }
    for (const d of json.response?.publishedfiledetails ?? []) {
      const id = String(d.publishedfileid ?? '')
      if (!id) continue
      const result = num(d.result) ?? 0
      const banned = d.banned === 1 || d.banned === '1' || d.banned === true
      const status = statusOf(result, banned)
      if (status !== 'ok' && status !== 'banned') {
        out.set(id, { id, status, result })
        continue
      }
      out.set(id, {
        id,
        status,
        result,
        appId: num(d.consumer_app_id),
        title: typeof d.title === 'string' ? d.title : undefined,
        description: typeof d.description === 'string' ? d.description : undefined,
        previewUrl: typeof d.preview_url === 'string' ? d.preview_url : undefined,
        fileSize: num(d.file_size),
        timeCreated: num(d.time_created),
        timeUpdated: num(d.time_updated),
        subscriptions: num(d.subscriptions),
        lifetimeSubscriptions: num(d.lifetime_subscriptions),
        favorited: num(d.favorited),
        views: num(d.views),
        tags: Array.isArray(d.tags)
          ? (d.tags as Array<{ tag?: unknown }>).map(t => String(t.tag ?? '')).filter(Boolean)
          : [],
        creator: typeof d.creator === 'string' ? d.creator : undefined,
        banned,
      })
    }
  }
  return out
}

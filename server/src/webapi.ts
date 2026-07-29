import type { RemoteMod } from './types.js'

const ENDPOINT = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
const CHUNK = 100

function num(v: unknown): number | undefined {
  const x = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN
  return Number.isFinite(x) ? x : undefined
}

// Keyless batch endpoint, verified live: POST form-encoded, 24 fields per item,
// bogus ids come back as result=9 inside a 200 envelope.
export async function fetchPublishedFileDetails(ids: string[]): Promise<RemoteMod[]> {
  const out: RemoteMod[] = []
  for (let ofs = 0; ofs < ids.length; ofs += CHUNK) {
    const chunk = ids.slice(ofs, ofs + CHUNK)
    const body = new URLSearchParams()
    body.set('itemcount', String(chunk.length))
    chunk.forEach((id, i) => body.set(`publishedfileids[${i}]`, id))
    const res = await fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`GetPublishedFileDetails HTTP ${res.status}`)
    const json = (await res.json()) as {
      response?: { publishedfiledetails?: Array<Record<string, unknown>> }
    }
    for (const d of json.response?.publishedfiledetails ?? []) {
      const id = String(d.publishedfileid ?? '')
      if (!id) continue
      const result = num(d.result) ?? 0
      if (result !== 1) {
        out.push({ id, result })
        continue
      }
      out.push({
        id,
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
        banned: d.banned === 1 || d.banned === '1',
      })
    }
  }
  return out
}

import type { BrowseResult, ChangelogPage, HubState, Settings } from './types'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      // keep HTTP status message
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  state: (): Promise<HubState> => fetch('/api/state').then(r => json<HubState>(r)),

  changelog: (modId: string, page = 1): Promise<ChangelogPage> =>
    fetch(`/api/mods/${modId}/changelog?page=${page}`).then(r => json<ChangelogPage>(r)),

  description: (modId: string): Promise<{ description: string }> =>
    fetch(`/api/mods/${modId}/description`).then(r => json<{ description: string }>(r)),

  poll: (): Promise<{ ok: boolean }> =>
    fetch('/api/poll', { method: 'POST' }).then(r => json<{ ok: boolean }>(r)),

  sync: (appId: number): Promise<{ ok: boolean; count: number }> =>
    fetch(`/api/sync/${appId}`, { method: 'POST' }).then(r => json<{ ok: boolean; count: number }>(r)),

  action: (
    action: 'subscribe' | 'unsubscribe' | 'download' | 'force',
    appId: number,
    modId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    fetch(`/api/actions/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, modId }),
    }).then(r => json<{ ok: boolean; error?: string }>(r)),

  browse: (appId: number, page: number, sort: string, q: string): Promise<BrowseResult> =>
    fetch(
      `/api/browse/${appId}?page=${page}&sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(q)}`,
    ).then(r => json<BrowseResult>(r)),

  saveSettings: (patch: Partial<Settings>): Promise<{ ok: boolean; settings: Settings }> =>
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => json<{ ok: boolean; settings: Settings }>(r)),
}

export function img(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  return `/api/img?u=${encodeURIComponent(url)}`
}

export type SseHandler = (event: string, data: Record<string, unknown>) => void

export function connectEvents(handler: SseHandler): () => void {
  const es = new EventSource('/api/events')
  const names = ['refresh', 'helper', 'action-done', 'changelog-ready']
  for (const name of names) {
    es.addEventListener(name, e => {
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse((e as MessageEvent).data as string) as Record<string, unknown>
      } catch {
        // ignore malformed payloads
      }
      handler(name, data)
    })
  }
  return () => es.close()
}

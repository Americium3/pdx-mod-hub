import path from 'node:path'
import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import { DATA_DIR } from './config.js'
import { readJson, writeJson } from './store.js'
import type { ChangelogEntry, ChangelogPage } from './types.js'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// steamcommunity.com throttles cold bursts (429 seen live at 2 rapid requests),
// so every page fetch goes through one global queue with fixed spacing.
const SPACING_MS = 4_000
const MAX_RETRIES = 3

let chain: Promise<unknown> = Promise.resolve()
let lastRun = 0

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = lastRun + SPACING_MS - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    try {
      return await fn()
    } finally {
      lastRun = Date.now()
    }
  })
  chain = next.catch(() => undefined)
  return next as Promise<T>
}

const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'br', 'ul', 'ol', 'li', 'a'])

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function sanitizeNode($: cheerio.CheerioAPI, node: AnyNode): string {
  if (node.type === 'text') return escapeHtml($(node).text())
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return ''
  const el = node as unknown as { name: string; children: AnyNode[]; attribs: Record<string, string> }
  if (node.type === 'script' || node.type === 'style') return ''
  const inner = (el.children ?? []).map(c => sanitizeNode($, c)).join('')
  const tag = el.name?.toLowerCase()
  if (!tag || !ALLOWED_TAGS.has(tag)) return inner
  if (tag === 'br') return '<br>'
  if (tag === 'a') {
    const href = el.attribs?.href ?? ''
    if (/^https?:\/\//i.test(href)) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
    }
    return inner
  }
  return `<${tag}>${inner}</${tag}>`
}

export class ChangelogNotFoundError extends Error {}

async function fetchPage(modId: string, page: number): Promise<ChangelogPage> {
  const url = `https://steamcommunity.com/sharedfiles/filedetails/changelog/${modId}?p=${page}`
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 429) {
      lastErr = new Error('HTTP 429')
      await new Promise(r => setTimeout(r, 30_000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`changelog HTTP ${res.status}`)
    const html = await res.text()
    const $ = cheerio.load(html)
    // Bad/removed ids return HTTP 200 with an error page.
    if ($('title').text().includes('Error')) throw new ChangelogNotFoundError(modId)
    const entries: ChangelogEntry[] = []
    $('div.changeLogCtn').each((_, ctn) => {
      const p = $(ctn).find('p[id]').first()
      const ts = Number(p.attr('id'))
      if (!Number.isFinite(ts) || ts <= 0) return
      const date = $(ctn).find('.changelog.headline').first().text().trim()
      const body = p.get(0)
      const html2 = body ? (body.children ?? []).map(c => sanitizeNode($, c as AnyNode)).join('') : ''
      entries.push({ ts, date, html: html2.trim() })
    })
    return { entries, hasMore: entries.length >= 10 }
  }
  throw lastErr instanceof Error ? lastErr : new Error('changelog fetch failed')
}

interface CacheFile {
  fetchedAt: number
  newestTs: number
  pages: Record<string, ChangelogPage>
}

function cachePath(modId: string): string {
  if (!/^\d+$/.test(modId)) throw new Error('bad mod id')
  return path.join(DATA_DIR, 'changelogs', `${modId}.json`)
}

// remoteTs: the currently known remote time_updated; a newer remote invalidates page 1.
export async function getChangelog(modId: string, page: number, remoteTs?: number): Promise<ChangelogPage> {
  const file = cachePath(modId)
  const cache = readJson<CacheFile>(file, { fetchedAt: 0, newestTs: 0, pages: {} })
  const key = String(page)
  const stale = page === 1 && remoteTs !== undefined && remoteTs > cache.newestTs
  if (cache.pages[key] && !stale) return cache.pages[key]

  const fetched = await throttled(() => fetchPage(modId, page))
  if (stale) cache.pages = {} // history shifted: drop all cached pages
  cache.pages[key] = fetched
  cache.fetchedAt = Math.floor(Date.now() / 1000)
  if (page === 1 && fetched.entries.length > 0) cache.newestTs = fetched.entries[0].ts
  writeJson(file, cache)
  return fetched
}

export function peekChangelog(modId: string, page: number): ChangelogPage | undefined {
  const cache = readJson<CacheFile>(cachePath(modId), { fetchedAt: 0, newestTs: 0, pages: {} })
  return cache.pages[String(page)]
}

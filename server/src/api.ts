import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Request, Response } from 'express'
import {
  APP_NAME,
  APP_VERSION,
  WEB_DIST,
  clampPollInterval,
  saveSettings,
} from './config.js'
import { ChangelogNotFoundError, getChangelog } from './changelog.js'
import { currentSeq, queryFeed } from './events.js'
import { runHelper } from './helper.js'
import {
  addPending,
  addToSubs,
  buildModDetail,
  buildState,
  hub,
  pollRemote,
  removeFromSubs,
  requestWatcherRefresh,
  reschedulePoll,
  resolveLibraries,
  saveSubs,
  scanAcfs,
  trackHelper,
} from './hub.js'
import { serveImage } from './images.js'
import { addClient, broadcast, broadcastPoke } from './sse.js'
import type { Settings, SubsCache } from './types.js'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Tailwind injects inline styles
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function createApp(port: number): express.Express {
  const app = express()
  app.disable('x-powered-by')

  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    '127.0.0.1:5173',
    'localhost:5173',
  ])
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ])

  // Middleware order per BUILD_CHECKLIST item 1: Host allowlist -> security
  // headers -> Origin allowlist + X-PMH -> express.json(type:'application/json').
  app.use((req: Request, res: Response, next: express.NextFunction) => {
    // (1) Host allowlist on ALL routes kills DNS-rebinding reads.
    if (!allowedHosts.has(req.headers.host ?? '')) {
      res.status(403).json({ error: 'bad host' })
      return
    }
    // (2) Security headers on every response (SPA included).
    res.setHeader('Content-Security-Policy', CSP)
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    // (3) CSRF: Origin allowlist on every non-GET route.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin
      if (origin && !allowedOrigins.has(origin)) {
        res.status(403).json({ error: 'bad origin' })
        return
      }
    }
    // (4) Custom header on all /api routes except GET /api/img and the SSE
    // stream: forces a preflight for any cross-origin caller (CORS never enabled).
    if (req.path.startsWith('/api/')) {
      const exempt = req.method === 'GET' && (req.path === '/api/img' || req.path === '/api/events')
      if (!exempt && req.headers['x-pmh'] !== '1') {
        res.status(403).json({ error: 'missing X-PMH header' })
        return
      }
    }
    next()
  })

  app.use(express.json({ type: 'application/json' }))

  app.get('/api/ping', (_req, res) => {
    res.json({ app: APP_NAME, version: APP_VERSION, seq: currentSeq() })
  })

  app.get('/api/state', (_req, res) => {
    res.json(buildState())
  })

  app.get('/api/mods/:id', (req, res) => {
    const id = String(req.params.id)
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'bad id' })
      return
    }
    const detail = buildModDetail(id)
    if (!detail) {
      res.status(404).json({ error: 'unknown mod' })
      return
    }
    res.json(detail)
  })

  app.get('/api/feed', (req, res) => {
    const parseSeq = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      const n = Number(v)
      return Number.isInteger(n) && n >= 0 ? n : null
    }
    const beforeSeq = parseSeq(req.query.before_seq)
    const afterSeq = parseSeq(req.query.after_seq)
    if (beforeSeq === null || afterSeq === null) {
      res.status(400).json({ error: 'bad cursor' })
      return
    }
    const rawLimit = req.query.limit === undefined ? 50 : Number(req.query.limit)
    const limit = Number.isInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50
    res.json(queryFeed({ beforeSeq, afterSeq, limit }))
  })

  app.get('/api/events', (_req, res) => {
    addClient(res)
  })

  app.get('/api/img', (req, res) => {
    // Stage-B replaces this with the DNS-pinned SSRF-hardened proxy.
    void serveImage(req, res)
  })

  app.get('/api/mods/:id/description', (req, res) => {
    const rec = hub.mods.get(String(req.params.id))
    res.json({ description: rec?.remote?.meta?.description ?? '' })
  })

  app.get('/api/mods/:id/changelog', async (req, res) => {
    // Stage-A keeps the legacy ?page= surface; stage B replaces it with the
    // cursor (?before_ts&limit) API over locally-keyed entries.
    const id = String(req.params.id)
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'bad id' })
      return
    }
    const page = Math.max(1, Number(req.query.page) || 1)
    const remoteTs = hub.mods.get(id)?.remote?.remoteTs
    try {
      const data = await getChangelog(id, page, remoteTs)
      res.json(data)
    } catch (e) {
      if (e instanceof ChangelogNotFoundError) {
        res.status(404).json({ error: 'changelog unavailable' })
        return
      }
      res.status(502).json({ error: String(e instanceof Error ? e.message : e) })
    }
  })

  app.post('/api/poll', async (_req, res) => {
    await pollRemote('manual')
    res.json({ ok: hub.lastPoll.status === 'ok', lastPoll: hub.lastPoll })
  })

  app.post('/api/rescan', async (_req, res) => {
    resolveLibraries()
    await scanAcfs()
    broadcastPoke('state')
    res.json({ ok: true })
  })

  app.post('/api/sync/:appId', async (req, res) => {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'bad appId' })
      return
    }
    const result = await trackHelper(() => runHelper('sync', appId))
    if (!result.ok) {
      res.status(502).json(result)
      return
    }
    const items = (result.items ?? []) as Array<{ id: string; state: number }>
    const cache: SubsCache = {
      appId,
      syncedAt: Math.floor(Date.now() / 1000),
      ids: items.map(i => i.id),
      states: Object.fromEntries(items.map(i => [i.id, i.state])),
    }
    saveSubs(cache)
    broadcastPoke('state')
    void pollRemote('sync')
    res.json({ ok: true, count: cache.ids.length })
  })

  app.post('/api/probe-owned', async (_req, res) => {
    const host = hub.games.find(g => g.installed)
    if (!host) {
      res.status(409).json({ error: 'no installed Paradox game to host the probe' })
      return
    }
    const csv = hub.games.map(g => g.appId).join(',')
    const result = await trackHelper(() => runHelper('probe', host.appId, [csv]))
    if (!result.ok) {
      res.status(502).json(result)
      return
    }
    const owned = (result.owned ?? {}) as Record<string, { owned: boolean; installed: boolean }>
    for (const game of hub.games) {
      const entry = owned[String(game.appId)]
      if (entry) game.owned = entry.owned
    }
    broadcastPoke('state')
    res.json({ ok: true, owned })
  })

  app.post('/api/actions/:action', async (req, res) => {
    // Stage-A note: still a synchronous request/response; stage B converts this
    // to the async job queue (202 + actionId + SSE stages + GET /api/actions/:id).
    const action = String(req.params.action)
    const appId = Number((req.body as Record<string, unknown> | undefined)?.appId)
    const modId = String((req.body as Record<string, unknown> | undefined)?.modId ?? '')
    if (!['subscribe', 'unsubscribe', 'download', 'force'].includes(action)) {
      res.status(404).json({ error: 'unknown action' })
      return
    }
    if (!Number.isInteger(appId) || appId <= 0 || !/^\d+$/.test(modId)) {
      res.status(400).json({ error: 'bad appId/modId' })
      return
    }
    const result = await trackHelper(() => runHelper(action, appId, [modId]))
    if (result.ok) {
      if (action === 'subscribe' || action === 'force') {
        addPending(modId, appId)
        if (action === 'subscribe') addToSubs(appId, modId)
      }
      if (action === 'unsubscribe') removeFromSubs(appId, modId)
      setTimeout(() => void pollRemote(action), 5_000)
    }
    broadcast('action-done', { action, appId, modId, ok: result.ok, error: result.error })
    broadcastPoke('action', { action, modId, ok: result.ok })
    broadcastPoke('state')
    res.status(result.ok ? 200 : 502).json(result)
  })

  app.get('/api/browse/:appId', async (req, res) => {
    // Stage-B replaces this with POST /api/browse/:appId + sort-enum validation
    // and the helper browse session lifecycle.
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'bad appId' })
      return
    }
    const page = String(Math.max(1, Number(req.query.page) || 1))
    const sort = String(req.query.sort ?? 'trend')
    const q = String(req.query.q ?? '')
    const result = await trackHelper(() => runHelper('browse', appId, [page, sort, q]))
    res.status(result.ok ? 200 : 502).json(result)
  })

  // PATCH semantics: whitelist keys, prototype-pollution rejection, clamped poll
  // interval, per-field 422 errors, response echoes applied settings (must-fix 19).
  const settingsHandler = (req: Request, res: Response): void => {
    const body = req.body as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(422).json({ error: 'invalid settings', errors: { body: 'expected a JSON object' } })
      return
    }
    const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
    const ALLOWED = new Set(['pollIntervalSec', 'changelogPrefetch', 'language', 'steamRootOverride'])
    // Map, not a plain object: assigning errors['__proto__'] on an object would be
    // silently swallowed by the prototype setter and skip the 422.
    const errors = new Map<string, string>()
    const next: Settings = { ...hub.settings }
    for (const key of Object.keys(body)) {
      if (FORBIDDEN.has(key)) errors.set(key, 'forbidden key')
      else if (!ALLOWED.has(key)) errors.set(key, 'unknown setting')
    }
    if ('pollIntervalSec' in body && !errors.has('pollIntervalSec')) {
      const v = body.pollIntervalSec
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.set('pollIntervalSec', 'expected a number of seconds (60-3600)')
      } else {
        next.pollIntervalSec = clampPollInterval(v)
      }
    }
    if ('changelogPrefetch' in body && !errors.has('changelogPrefetch')) {
      if (typeof body.changelogPrefetch !== 'boolean') {
        errors.set('changelogPrefetch', 'expected a boolean')
      } else {
        next.changelogPrefetch = body.changelogPrefetch
      }
    }
    if ('language' in body && !errors.has('language')) {
      if (body.language !== 'en' && body.language !== 'zh') {
        errors.set('language', "expected 'en' or 'zh'")
      } else {
        next.language = body.language
      }
    }
    if ('steamRootOverride' in body && !errors.has('steamRootOverride')) {
      const v = body.steamRootOverride
      if (v === null || v === '') {
        next.steamRootOverride = undefined
      } else if (typeof v === 'string') {
        next.steamRootOverride = v.trim() || undefined
      } else {
        errors.set('steamRootOverride', 'expected a path string or null')
      }
    }
    if (errors.size > 0) {
      res.status(422).json({ error: 'invalid settings', errors: Object.fromEntries(errors) })
      return
    }
    const rootChanged = next.steamRootOverride !== hub.settings.steamRootOverride
    const intervalChanged = next.pollIntervalSec !== hub.settings.pollIntervalSec
    hub.settings = next
    saveSettings(next)
    if (rootChanged) {
      resolveLibraries()
      void scanAcfs()
      requestWatcherRefresh()
    }
    if (intervalChanged) reschedulePoll()
    broadcastPoke('state')
    res.json({ ok: true, settings: next })
  }
  app.patch('/api/settings', settingsHandler)
  app.post('/api/settings', settingsHandler) // legacy alias until the new SPA lands

  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next()
        return
      }
      res.sendFile(path.join(WEB_DIST, 'index.html'))
    })
  }

  return app
}

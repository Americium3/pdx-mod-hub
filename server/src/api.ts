import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { Request, Response } from 'express'
import {
  APP_NAME,
  APP_VERSION,
  DATA_DIR,
  WEB_DIST,
  clampPollInterval,
  saveSettings,
} from './config.js'
import {
  enqueueAction,
  getJob,
  SteamNotRunningError,
  type ActionKind,
} from './actions.js'
import { getChangelogCursor } from './changelog.js'
import { currentSeq, queryFeed } from './events.js'
import { HelperInitError, runHelper, runWithSession } from './helper.js'
import {
  accountOf,
  buildModDetail,
  buildState,
  descriptionHtmlOf,
  hub,
  pollRemote,
  requestWatcherRefresh,
  reschedulePoll,
  resolveLibraries,
  scanAcfs,
  trackHelper,
} from './hub.js'
import { clearImageCache, imageCacheStats, serveImage } from './images.js'
import { getPersona, requestPersonas } from './personas.js'
import { addClient, broadcastPoke } from './sse.js'
import { isSteamRunning } from './steam/locate.js'
import type { Settings } from './types.js'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Tailwind injects inline styles; the SPA loads the IBM Plex / Noto Sans SC
  // tri-voice stylesheet from Google Fonts (web/index.html).
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

// Browse sort enum (must-fix 8): server-validated q/sort combos; Steam's
// UGCQueryType constants are mapped strictly server-side.
const BROWSE_SORTS: Record<
  string,
  { queryType: number; trendDays?: number; requiresQ?: boolean }
> = {
  relevance: { queryType: 11, requiresQ: true }, // RankedByTextSearch
  updated: { queryType: 19 }, // RankedByLastUpdatedDate
  published: { queryType: 1 }, // RankedByPublicationDate
  trend7d: { queryType: 3, trendDays: 7 }, // RankedByTrend
  trend30d: { queryType: 3, trendDays: 30 },
  popular: { queryType: 12 }, // RankedByTotalUniqueSubscriptions
}
const BROWSE_PER_PAGE = 50
const BROWSE_RESULT_CAP = 1_000 // Steam UGC queries cap out at 1000 results
const BROWSE_MAX_PAGE = BROWSE_RESULT_CAP / BROWSE_PER_PAGE

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
    const creator = typeof detail.creator === 'string' ? detail.creator : null
    const persona = getPersona(creator)
    if (persona) {
      detail.authorName = persona.name
      detail.authorAvatarUrl = persona.avatarUrl ?? null
    } else if (creator) {
      requestPersonas([creator])
    }
    res.json(detail)
  })

  // Cached persona lookups; misses are enqueued for the background resolver,
  // so the client re-asks a few seconds later (resolution is never inline).
  app.get('/api/personas', (req, res) => {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (ids.length === 0 || ids.length > 100 || !ids.every(id => /^\d{17}$/.test(id))) {
      res.status(400).json({ error: 'ids must be 1-100 comma-separated SteamID64s' })
      return
    }
    const personas: Record<string, { name: string; avatarUrl?: string }> = {}
    const missing: string[] = []
    for (const id of ids) {
      const p = getPersona(id)
      if (p) personas[id] = p
      else missing.push(id)
    }
    requestPersonas(missing)
    res.json({ personas, pending: missing.length })
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

  // ------------------------------------------------------------ image proxy

  app.get('/api/img', (req, res) => {
    void serveImage(req, res)
  })

  app.get('/api/imgcache', (_req, res) => {
    res.json(imageCacheStats())
  })

  app.post('/api/imgcache', (_req, res) => {
    const removed = clearImageCache()
    res.json({ ok: true, removed, ...imageCacheStats() })
  })

  // Reveal a folder in Explorer. Only two shapes are allowed and both resolve
  // to server-derived paths — the client can never open an arbitrary path:
  //   {appId, modId} -> <library>\steamapps\workshop\content\<appId>\<modId>
  //   {} or {path}   -> the data folder (path, if sent, must equal it)
  app.post('/api/open-folder', (req, res) => {
    const body = (req.body ?? {}) as { appId?: unknown; modId?: unknown; path?: unknown }
    let target: string | null = null
    if (body.appId !== undefined || body.modId !== undefined) {
      const appId = Number(body.appId)
      const modId = String(body.modId ?? '')
      if (!Number.isInteger(appId) || appId <= 0 || !/^\d+$/.test(modId)) {
        res.status(400).json({ error: 'bad appId/modId' })
        return
      }
      const game = hub.games.find(g => g.appId === appId)
      if (!game?.libraryPath) {
        res.status(404).json({ error: 'game not found' })
        return
      }
      target = path.join(game.libraryPath, 'steamapps', 'workshop', 'content', String(appId), modId)
    } else {
      const dataDir = path.resolve(DATA_DIR)
      if (typeof body.path === 'string' && body.path.trim() !== '') {
        if (path.resolve(body.path) !== dataDir) {
          res.status(403).json({ error: 'path not allowed' })
          return
        }
      }
      target = dataDir
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      res.status(404).json({ error: 'folder not found' })
      return
    }
    spawn('explorer.exe', [target], { windowsHide: false, detached: true, stdio: 'ignore' }).unref()
    res.json({ ok: true })
  })

  // ------------------------------------------------------------ mod content

  // Legacy alias for the pre-SPA client; serves the SANITIZED description.
  app.get('/api/mods/:id/description', (req, res) => {
    const rec = hub.mods.get(String(req.params.id))
    res.json({ description: rec ? descriptionHtmlOf(rec) : '' })
  })

  // Cursor changelog API (must-fix 2): ?before_ts=&limit=20 over the locally
  // keyed (modId, ts, ord) entry list. Steam's ?p=N never reaches this surface.
  app.get('/api/mods/:id/changelog', async (req, res) => {
    const id = String(req.params.id)
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'bad id' })
      return
    }
    let beforeTs: number | undefined
    if (req.query.before_ts !== undefined) {
      const n = Number(req.query.before_ts)
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: 'bad before_ts' })
        return
      }
      beforeTs = n
    }
    const rawLimit = req.query.limit === undefined ? 20 : Number(req.query.limit)
    const limit = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20
    const remoteTs = hub.mods.get(id)?.remote?.remoteTs
    try {
      res.json(await getChangelogCursor(id, { beforeTs, limit }, remoteTs))
    } catch (e) {
      res.status(502).json({ error: String(e instanceof Error ? e.message : e) })
    }
  })

  // ------------------------------------------------------------ maintenance

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

  // ------------------------------------------------------------ action jobs

  const submitJob = (res: Response, kind: ActionKind, appId: number, modId?: string): void => {
    try {
      const job = enqueueAction(kind, appId, modId)
      res.status(202).json({ actionId: job.actionId, stage: job.stage, queuePosition: job.queuePosition })
    } catch (e) {
      if (e instanceof SteamNotRunningError) {
        res.status(409).json({ error: 'steam_not_running' })
        return
      }
      res.status(500).json({ error: String(e instanceof Error ? e.message : e) })
    }
  }

  app.post('/api/actions/:action', (req, res) => {
    const action = String(req.params.action)
    if (!['subscribe', 'unsubscribe', 'download', 'force'].includes(action)) {
      res.status(404).json({ error: 'unknown action' })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const appId = Number(body.appId)
    const modId = String(body.modId ?? '')
    if (!Number.isInteger(appId) || appId <= 0 || !/^\d+$/.test(modId)) {
      res.status(400).json({ error: 'bad appId/modId' })
      return
    }
    submitJob(res, action as ActionKind, appId, modId)
  })

  app.get('/api/actions/:id', (req, res) => {
    const job = getJob(String(req.params.id))
    if (!job) {
      res.status(404).json({ error: 'unknown action' })
      return
    }
    res.json(job)
  })

  app.post('/api/sync/:appId', (req, res) => {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'bad appId' })
      return
    }
    submitJob(res, 'sync', appId)
  })

  app.post('/api/sync', (_req, res) => {
    submitJob(res, 'syncAll', 0)
  })

  // ------------------------------------------------------------ browse

  // POST — a helper-spawning endpoint must never be a cacheable/prefetchable GET.
  app.post('/api/browse/:appId', async (req, res) => {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'bad appId' })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    if (body.q !== undefined && typeof body.q !== 'string') {
      res.status(400).json({ error: 'bad q' })
      return
    }
    const q = typeof body.q === 'string' ? body.q.trim().slice(0, 200) : ''
    const sortKey = body.sort === undefined ? (q ? 'relevance' : 'trend7d') : String(body.sort)
    const sort = BROWSE_SORTS[sortKey]
    if (!sort) {
      res.status(400).json({ error: 'bad sort', allowed: Object.keys(BROWSE_SORTS) })
      return
    }
    if (sort.requiresQ && q === '') {
      res.status(400).json({ error: 'sort=relevance requires q' })
      return
    }
    if (!sort.requiresQ && q !== '') {
      res.status(400).json({ error: 'q is only valid with sort=relevance' })
      return
    }
    const page = body.page === undefined ? 1 : Number(body.page)
    if (!Number.isInteger(page) || page < 1 || page > BROWSE_MAX_PAGE) {
      res.status(400).json({ error: `page must be 1..${BROWSE_MAX_PAGE}` })
      return
    }
    hub.steamRunning = isSteamRunning()
    if (!hub.steamRunning) {
      res.status(409).json({ error: 'steam_not_running' })
      return
    }
    try {
      const result = await runWithSession(appId, s =>
        s.request(
          { op: 'browse', page, queryType: sort.queryType, trendDays: sort.trendDays, q },
          60_000,
        ),
      )
      if (!result.ok) {
        res.status(502).json({ error: result.error ?? 'browse failed' })
        return
      }
      // server-side cross-reference against account set + ACF (must-fix 8)
      const acf = hub.acfByApp.get(appId)
      const unresolvedOwners: string[] = []
      const items = (Array.isArray(result.items) ? result.items : []).map(raw => {
        const item = raw as Record<string, unknown>
        const id = String(item.id ?? '')
        const owner = typeof item.owner === 'string' ? item.owner : null
        const persona = getPersona(owner)
        if (owner && !persona) unresolvedOwners.push(owner)
        return {
          ...item,
          subscribed: accountOf(id, appId)?.subscribed ?? false,
          installed: acf?.has(id) ?? false,
          author: persona?.name ?? null,
          authorAvatarUrl: persona?.avatarUrl ?? null,
        }
      })
      // async by design: routes serve the cache, the queue fills it, the client re-asks
      requestPersonas(unresolvedOwners)
      const total = typeof result.total === 'number' ? result.total : items.length
      res.json({ items, page, perPage: BROWSE_PER_PAGE, total, capped: total > BROWSE_RESULT_CAP })
    } catch (e) {
      if (e instanceof HelperInitError) {
        res.status(502).json({ error: 'helper_init_failed', detail: e.message })
        return
      }
      res.status(502).json({ error: String(e instanceof Error ? e.message : e) })
    }
  })

  // ------------------------------------------------------------ settings

  // PATCH semantics: whitelist keys, prototype-pollution rejection, clamped poll
  // interval, per-field 422 errors, response echoes applied settings (must-fix 19).
  const settingsHandler = (req: Request, res: Response): void => {
    const body = req.body as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(422).json({ error: 'invalid settings', errors: { body: 'expected a JSON object' } })
      return
    }
    const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
    const ALLOWED = new Set([
      'pollIntervalSec',
      'changelogPrefetch',
      'language',
      'steamRootOverride',
      'steamWebApiKey',
    ])
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
    if ('steamWebApiKey' in body && !errors.has('steamWebApiKey')) {
      const v = body.steamWebApiKey
      if (v === null || v === '') {
        next.steamWebApiKey = undefined
      } else if (typeof v === 'string' && /^[0-9A-F]{32}$/i.test(v.trim())) {
        next.steamWebApiKey = v.trim()
      } else {
        errors.set('steamWebApiKey', 'expected a 32-hex-character Steam Web API key or empty')
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

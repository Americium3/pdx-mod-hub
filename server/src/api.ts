import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { WEB_DIST, saveSettings } from './config.js'
import { ChangelogNotFoundError, getChangelog } from './changelog.js'
import { runHelper } from './helper.js'
import {
  addPending,
  buildState,
  hub,
  pollRemote,
  removeFromSubs,
  rescanLocal,
  saveSubs,
} from './hub.js'
import { serveImage } from './images.js'
import { addClient, broadcast } from './sse.js'
import type { Settings, SubsCache } from './types.js'

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

export function createApp(port: number): express.Express {
  const app = express()
  app.use(express.json())

  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    'localhost:5173',
    '127.0.0.1:5173',
  ])
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...DEV_ORIGINS,
  ])

  // Localhost hardening: refuse DNS-rebound hosts and cross-origin writes.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? ''
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: 'bad host' })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin
      if (origin && !allowedOrigins.has(origin)) {
        res.status(403).json({ error: 'bad origin' })
        return
      }
    }
    next()
  })

  app.get('/api/state', (_req, res) => {
    res.json(buildState())
  })

  app.get('/api/events', (_req, res) => {
    addClient(res)
  })

  app.get('/api/img', (req, res) => {
    void serveImage(req, res)
  })

  app.get('/api/mods/:id/description', (req, res) => {
    const rm = hub.remote.get(String(req.params.id))
    res.json({ description: rm?.description ?? '' })
  })

  app.get('/api/mods/:id/changelog', async (req, res) => {
    const id = String(req.params.id)
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'bad id' })
      return
    }
    const page = Math.max(1, Number(req.query.page) || 1)
    const remoteTs = hub.remote.get(id)?.timeUpdated
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
    res.json({ ok: true, lastPoll: hub.lastPoll, error: hub.lastPollError })
  })

  app.post('/api/rescan', (_req, res) => {
    rescanLocal()
    broadcast('refresh', { reason: 'rescan' })
    res.json({ ok: true })
  })

  app.post('/api/sync/:appId', async (req, res) => {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'bad appId' })
      return
    }
    const result = await runHelper('sync', appId)
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
    const result = await runHelper('probe', host.appId, [csv])
    if (!result.ok) {
      res.status(502).json(result)
      return
    }
    const owned = (result.owned ?? {}) as Record<string, { owned: boolean; installed: boolean }>
    for (const game of hub.games) {
      const entry = owned[String(game.appId)]
      if (entry) game.owned = entry.owned
    }
    broadcast('refresh', { reason: 'probe' })
    res.json({ ok: true, owned })
  })

  app.post('/api/actions/:action', async (req, res) => {
    const action = String(req.params.action)
    const appId = Number(req.body?.appId)
    const modId = String(req.body?.modId ?? '')
    if (!['subscribe', 'unsubscribe', 'download', 'force'].includes(action)) {
      res.status(404).json({ error: 'unknown action' })
      return
    }
    if (!Number.isInteger(appId) || appId <= 0 || !/^\d+$/.test(modId)) {
      res.status(400).json({ error: 'bad appId/modId' })
      return
    }
    const result = await runHelper(action, appId, [modId])
    if (result.ok) {
      if (action === 'subscribe' || action === 'force') addPending(modId)
      if (action === 'unsubscribe') removeFromSubs(appId, modId)
      setTimeout(() => void pollRemote(action), 5_000)
    }
    broadcast('action-done', { action, appId, modId, ok: result.ok, error: result.error })
    res.status(result.ok ? 200 : 502).json(result)
  })

  app.get('/api/browse/:appId', async (req, res) => {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'bad appId' })
      return
    }
    const page = String(Math.max(1, Number(req.query.page) || 1))
    const sort = String(req.query.sort ?? 'trend')
    const q = String(req.query.q ?? '')
    const result = await runHelper('browse', appId, [page, sort, q])
    res.status(result.ok ? 200 : 502).json(result)
  })

  app.post('/api/settings', (req, res) => {
    const body = req.body as Partial<Settings>
    const next: Settings = { ...hub.settings }
    if (typeof body.pollIntervalMin === 'number' && body.pollIntervalMin >= 1 && body.pollIntervalMin <= 120) {
      next.pollIntervalMin = Math.round(body.pollIntervalMin)
    }
    if (typeof body.changelogPrefetch === 'boolean') next.changelogPrefetch = body.changelogPrefetch
    if (body.language === 'en' || body.language === 'zh') next.language = body.language
    if (typeof body.steamRootOverride === 'string') {
      next.steamRootOverride = body.steamRootOverride.trim() || undefined
    }
    hub.settings = next
    saveSettings(next)
    rescanLocal()
    broadcast('refresh', { reason: 'settings' })
    res.json({ ok: true, settings: next })
  })

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

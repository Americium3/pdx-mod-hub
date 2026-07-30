'use strict'
// Steamworks helper. Two modes:
//
// One-shot (legacy CLI): one process per invocation, one appid per process.
//   node steam_helper.js <cmd> <appId> [args...]
//     sync <appId>                       -> list account workshop subscriptions + local state
//     probe <hostAppId> <csvAppIds>      -> ownership/install check for other appids
//     subscribe <appId> <modId>          -> subscribe + kick download
//     unsubscribe <appId> <modId>
//     download <appId> <modId>           -> force download/update (highPriority)
//     force <appId> <modId>              -> unsub -> resub -> download (stale-cache fallback)
//     browse <appId> <page> <sort> [q]   -> workshop UGC query page
//
// Session (stage B): one persistent child per appid, newline-JSON protocol.
//   node steam_helper.js session <appId>
//     stdout on start: {type:'hello', ok:true, appId, items:[...]} — the
//       getSubscribedItems piggyback that freshens the account set for this
//       app on EVERY session start (zero extra flashes).
//     stdin:  {reqId, op: browse|sync|subscribe|unsubscribe|download|force|exit, ...}
//     stdout: {reqId, type:'progress', stage} interim lines, then {reqId, ok, ...}
//
// Initializing Steamworks marks the account "in-game" for that appid, so
// one-shot runs stay short and sessions are bounded by the server (60s idle /
// 10min hard cap) plus a local self-destruct backstop.

function out(obj) {
  process.stdout.write(
    JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n',
  )
}

function fail(error, code) {
  out({ ok: false, error: String((error && error.message) || error) })
  process.exit(code || 2)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const argv = process.argv.slice(2)
const cmd = argv[0]
const appId = Number(argv[1])
if (!cmd || !Number.isInteger(appId) || appId <= 0) {
  fail('usage: steam_helper <cmd> <appId> [args...]')
}

const SESSION_MODE = cmd === 'session'

// Never linger: one-shot flashes stay short even if something wedges; sessions
// self-destruct just past the server's 10min hard cap.
setTimeout(() => fail('helper hard timeout', 3), SESSION_MODE ? 660000 : 110000).unref()

let sw
try {
  sw = require('steamworks.js')
} catch (e) {
  fail(e)
}

// UGCQueryType values from steamworks.js client.d.ts (const enums, so numeric here).
const SORTS = {
  votes: 0,
  recent: 1,
  trend: 3,
  text: 11,
  subs: 12,
  updated: 19,
}
const SESSION_QUERY_TYPES = [1, 3, 11, 12, 19]

function itemJson(ws, id) {
  const info = ws.installInfo(id)
  return {
    id: id.toString(),
    state: ws.state(id),
    folder: info ? info.folder : null,
    sizeOnDisk: info ? info.sizeOnDisk : null,
    timestamp: info ? info.timestamp : null,
  }
}

function subscribedItems(ws) {
  return ws.getSubscribedItems().map(id => itemJson(ws, id))
}

function browseItemJson(item) {
  if (!item) return null
  const stats = item.statistics || {}
  return {
    id: item.publishedFileId.toString(),
    title: item.title,
    description: (item.description || '').slice(0, 400),
    previewUrl: item.previewUrl || null,
    owner: item.owner && item.owner.steamId64 != null ? item.owner.steamId64.toString() : null,
    timeCreated: item.timeCreated,
    timeUpdated: item.timeUpdated,
    tags: item.tags || [],
    numUpvotes: item.numUpvotes,
    numDownvotes: item.numDownvotes,
    subscriptions: stats.numSubscriptions != null ? stats.numSubscriptions.toString() : null,
    banned: item.banned,
    url: item.url,
    // Required items (dependencies) so the client's RequiredItemsDialog can wire
    // up; the UGC query result exposes children by publishedFileId.
    children: (item.children || []).map(c =>
      c && c.publishedFileId != null ? c.publishedFileId.toString() : String(c),
    ),
  }
}

async function waitDownloadSignal(ws, id, maxMs) {
  // EItemState: 1 subscribed, 4 installed, 8 needs update, 16 downloading, 32 pending.
  const start = Date.now()
  for (;;) {
    const state = ws.state(id)
    const dl = ws.downloadInfo(id)
    const active = (state & 16) !== 0 || (state & 32) !== 0 || dl !== null
    const settled = (state & 4) !== 0 && (state & 8) === 0 && !active
    if (active || settled || Date.now() - start > maxMs) {
      return { state, downloading: active, settled, downloadInfo: dl }
    }
    await sleep(400)
  }
}

function parseModId(raw) {
  const s = String(raw == null ? '' : raw)
  if (!/^[0-9]+$/.test(s)) throw new Error('bad mod id: ' + s.slice(0, 40))
  return BigInt(s)
}

async function runBrowse(ws, { page, queryType, trendDays, q }) {
  const p = Math.max(1, Number(page) || 1)
  const qt = SESSION_QUERY_TYPES.includes(Number(queryType)) ? Number(queryType) : SORTS.trend
  const cfg = {
    language: 'english',
    includeLongDescription: false,
  }
  const text = String(q || '').trim()
  if (text) cfg.searchText = text
  if (qt === SORTS.trend) cfg.rankedByTrendDays = trendDays === 30 ? 30 : 7
  const result = await ws.getAllItems(p, qt, 0, appId, appId, cfg)
  return {
    page: p,
    total: result.totalResults,
    items: (result.items || []).map(browseItemJson).filter(Boolean),
  }
}

async function runAction(ws, op, modIdRaw, progress) {
  const id = parseModId(modIdRaw)
  switch (op) {
    case 'subscribe': {
      await ws.subscribe(id)
      progress('subscribed')
      await sleep(1000)
      const started = ws.download(id, true)
      progress('downloading')
      const signal = await waitDownloadSignal(ws, id, 5000)
      return { modId: id.toString(), started, ...signal }
    }
    case 'unsubscribe': {
      await ws.unsubscribe(id)
      return { modId: id.toString() }
    }
    case 'download': {
      const started = ws.download(id, true)
      progress('downloading')
      const signal = await waitDownloadSignal(ws, id, 6000)
      return { modId: id.toString(), started, ...signal }
    }
    case 'force': {
      // RimSort-style paced fallback for the stale-client-cache case.
      await ws.unsubscribe(id)
      await sleep(1200)
      await ws.subscribe(id)
      progress('subscribed')
      await sleep(1200)
      const started = ws.download(id, true)
      progress('downloading')
      const signal = await waitDownloadSignal(ws, id, 6000)
      return { modId: id.toString(), started, ...signal }
    }
    default:
      throw new Error('unknown op: ' + op)
  }
}

// ---------------------------------------------------------------- session mode

async function sessionMain(ws) {
  // Account piggyback on EVERY session start (must-fix 10).
  out({ type: 'hello', ok: true, appId, items: subscribedItems(ws) })

  const readline = require('node:readline')
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  let chain = Promise.resolve()

  rl.on('line', line => {
    const text = line.trim()
    if (!text) return
    let req
    try {
      req = JSON.parse(text)
    } catch {
      out({ ok: false, error: 'bad request json' })
      return
    }
    const reqId = typeof req.reqId === 'string' || typeof req.reqId === 'number' ? req.reqId : null
    const run = async () => {
      try {
        switch (req.op) {
          case 'exit':
            out({ reqId, ok: true, bye: true })
            process.exit(0)
            break
          case 'ping':
            out({ reqId, ok: true, appId })
            break
          case 'sync':
            out({ reqId, ok: true, appId, items: subscribedItems(ws) })
            break
          case 'browse': {
            const res = await runBrowse(ws, req)
            out({ reqId, ok: true, appId, ...res })
            break
          }
          case 'subscribe':
          case 'unsubscribe':
          case 'download':
          case 'force': {
            const res = await runAction(ws, req.op, req.modId, stage =>
              out({ reqId, type: 'progress', stage }),
            )
            out({ reqId, ok: true, appId, ...res })
            break
          }
          default:
            out({ reqId, ok: false, error: 'unknown op: ' + String(req.op) })
        }
      } catch (e) {
        out({ reqId, ok: false, error: String((e && e.message) || e) })
      }
    }
    chain = chain.then(run, run)
  })

  rl.on('close', () => process.exit(0)) // server closed stdin: shut down
  await new Promise(() => undefined) // stay alive until exit/stdin close
}

// ---------------------------------------------------------------- one-shot mode

async function oneShotMain(ws, apps) {
  switch (cmd) {
    case 'sync': {
      out({ ok: true, appId, items: subscribedItems(ws) })
      break
    }
    case 'probe': {
      const targets = String(argv[2] || '')
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isInteger(n) && n > 0)
      const owned = {}
      for (const target of targets) {
        owned[String(target)] = {
          owned: apps.isSubscribedApp(target),
          installed: apps.isAppInstalled(target),
        }
      }
      // account piggyback for the host app on every launch (must-fix 10)
      out({ ok: true, hostAppId: appId, owned, piggyback: subscribedItems(ws) })
      break
    }
    case 'subscribe':
    case 'unsubscribe':
    case 'download':
    case 'force': {
      const res = await runAction(ws, cmd, argv[2], () => undefined)
      out({ ok: true, appId, ...res, piggyback: subscribedItems(ws) })
      break
    }
    case 'browse': {
      const page = Math.max(1, Number(argv[2]) || 1)
      const sortKey = String(argv[3] || 'trend')
      const q = String(argv[4] || '').trim()
      const queryType = q ? SORTS.text : SORTS[sortKey] != null ? SORTS[sortKey] : SORTS.trend
      const res = await runBrowse(ws, { page, queryType, trendDays: 7, q })
      out({ ok: true, appId, ...res })
      break
    }
    default:
      fail('unknown command: ' + cmd)
  }
  process.exit(0)
}

async function main() {
  let client
  try {
    client = sw.init(appId)
  } catch (e) {
    fail('init failed: ' + ((e && e.message) || e))
  }
  const ws = (client && client.workshop) || sw.workshop
  const apps = (client && client.apps) || sw.apps

  if (SESSION_MODE) await sessionMain(ws)
  else await oneShotMain(ws, apps)
}

main().catch(e => fail(e))

'use strict'
// Short-lived Steamworks helper. One process per invocation, one appid per process.
// Initializing Steamworks marks the account "in-game" for that appid, so every
// command does the minimum work and exits immediately.
//
// Usage: node steam_helper.js <cmd> <appId> [args...]
//   sync <appId>                       -> list account workshop subscriptions + local state
//   probe <hostAppId> <csvAppIds>      -> ownership/install check for other appids
//   subscribe <appId> <modId>          -> subscribe + kick download
//   unsubscribe <appId> <modId>
//   download <appId> <modId>           -> force download/update (highPriority)
//   force <appId> <modId>              -> unsub -> resub -> download (stale-cache fallback)
//   browse <appId> <page> <sort> [q]   -> workshop UGC query page

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

// Never linger: the in-game flash must stay short even if something wedges.
setTimeout(() => fail('helper hard timeout', 3), 110000)

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

function browseItemJson(item) {
  if (!item) return null
  const stats = item.statistics || {}
  return {
    id: item.publishedFileId.toString(),
    title: item.title,
    description: (item.description || '').slice(0, 400),
    previewUrl: item.previewUrl || null,
    timeCreated: item.timeCreated,
    timeUpdated: item.timeUpdated,
    tags: item.tags || [],
    numUpvotes: item.numUpvotes,
    numDownvotes: item.numDownvotes,
    subscriptions: stats.numSubscriptions != null ? stats.numSubscriptions.toString() : null,
    banned: item.banned,
    url: item.url,
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

async function main() {
  let client
  try {
    client = sw.init(appId)
  } catch (e) {
    fail('init failed: ' + ((e && e.message) || e))
  }
  const ws = (client && client.workshop) || sw.workshop
  const apps = (client && client.apps) || sw.apps

  switch (cmd) {
    case 'sync': {
      const ids = ws.getSubscribedItems()
      out({ ok: true, appId, items: ids.map(id => itemJson(ws, id)) })
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
      out({ ok: true, hostAppId: appId, owned })
      break
    }
    case 'subscribe': {
      const id = BigInt(argv[2])
      await ws.subscribe(id)
      await sleep(1000)
      const started = ws.download(id, true)
      const signal = await waitDownloadSignal(ws, id, 5000)
      out({ ok: true, appId, modId: id.toString(), started, ...signal })
      break
    }
    case 'unsubscribe': {
      const id = BigInt(argv[2])
      await ws.unsubscribe(id)
      out({ ok: true, appId, modId: id.toString() })
      break
    }
    case 'download': {
      const id = BigInt(argv[2])
      const started = ws.download(id, true)
      const signal = await waitDownloadSignal(ws, id, 6000)
      out({ ok: true, appId, modId: id.toString(), started, ...signal })
      break
    }
    case 'force': {
      // RimSort-style paced fallback for the stale-client-cache case.
      const id = BigInt(argv[2])
      await ws.unsubscribe(id)
      await sleep(1200)
      await ws.subscribe(id)
      await sleep(1200)
      const started = ws.download(id, true)
      const signal = await waitDownloadSignal(ws, id, 6000)
      out({ ok: true, appId, modId: id.toString(), started, ...signal })
      break
    }
    case 'browse': {
      const page = Math.max(1, Number(argv[2]) || 1)
      const sortKey = String(argv[3] || 'trend')
      const q = String(argv[4] || '').trim()
      const queryType = q ? SORTS.text : (SORTS[sortKey] != null ? SORTS[sortKey] : SORTS.trend)
      const cfg = {
        language: 'english',
        includeLongDescription: false,
      }
      if (q) cfg.searchText = q
      if (queryType === SORTS.trend) cfg.rankedByTrendDays = 7
      const result = await ws.getAllItems(page, queryType, 0, appId, appId, cfg)
      out({
        ok: true,
        appId,
        page,
        total: result.totalResults,
        items: (result.items || []).map(browseItemJson).filter(Boolean),
      })
      break
    }
    default:
      fail('unknown command: ' + cmd)
  }
  process.exit(0)
}

main().catch(e => fail(e))

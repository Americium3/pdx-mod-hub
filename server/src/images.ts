import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Request, Response } from 'express'
import { DATA_DIR } from './config.js'

// /api/img SSRF hardening (must-fix 6):
//   https only; hostname allowlist (Steam CDNs); every hostname is DNS-resolved
//   and rejected when any address is private/loopback/link-local; redirects are
//   followed manually (max 2 hops) re-validating each hop; content-type must be
//   image/*; 10MB per-object cap (aborted mid-stream when exceeded); cache files
//   named sha256(url); LRU pruned to 500MB. GET size / POST clear are exposed
//   as /api/imgcache (X-PMH protected by the global middleware).

const CACHE_DIR = path.join(DATA_DIR, 'imgcache')
const MAX_CACHE_BYTES = 500 * 1024 * 1024
const MAX_OBJECT_BYTES = 10 * 1024 * 1024
const MAX_REDIRECT_HOPS = 2
const FETCH_TIMEOUT_MS = 15_000

const ALLOWED_HOSTS = new Set(['images.steamusercontent.com', 'steamuserimages-a.akamaihd.net'])
const ALLOWED_SUFFIXES = ['.steamstatic.com']

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (ALLOWED_HOSTS.has(h)) return true
  return ALLOWED_SUFFIXES.some(suf => h.endsWith(suf) && h.length > suf.length)
}

// ---------------------------------------------------------------- private-range checks

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

const V4_BLOCKED: Array<[number, number]> = [
  // [base, maskBits]
  [ipv4ToInt('0.0.0.0'), 8], // "this network"
  [ipv4ToInt('10.0.0.0'), 8],
  [ipv4ToInt('100.64.0.0'), 10], // CGNAT
  [ipv4ToInt('127.0.0.0'), 8], // loopback
  [ipv4ToInt('169.254.0.0'), 16], // link-local
  [ipv4ToInt('172.16.0.0'), 12],
  [ipv4ToInt('192.0.0.0'), 24],
  [ipv4ToInt('192.168.0.0'), 16],
  [ipv4ToInt('198.18.0.0'), 15], // benchmarking
  [ipv4ToInt('224.0.0.0'), 4], // multicast
  [ipv4ToInt('240.0.0.0'), 4], // reserved + broadcast
]

function ipv4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip)
  return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)))
}

function ipBlocked(addr: string): boolean {
  const kind = net.isIP(addr)
  if (kind === 4) return ipv4Blocked(addr)
  if (kind === 6) {
    const a = addr.toLowerCase()
    if (a === '::' || a === '::1') return true
    if (a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb')) {
      return true // fe80::/10 link-local
    }
    if (a.startsWith('fc') || a.startsWith('fd')) return true // fc00::/7 ULA
    const m4 = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // v4-mapped
    if (m4) return ipv4Blocked(m4[1])
    return false
  }
  return true // not an IP literal at all
}

/** Resolve the host and reject when ANY answer is private/loopback/link-local. */
async function dnsSafe(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) return false // IP literals never pass the allowlist anyway
  let addrs
  try {
    addrs = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    return false
  }
  if (addrs.length === 0) return false
  return addrs.every(a => !ipBlocked(a.address))
}

async function validateUrl(u: URL): Promise<boolean> {
  if (u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  if (u.port && u.port !== '443') return false
  if (!hostAllowed(u.hostname)) return false
  return dnsSafe(u.hostname)
}

/** Magic-byte image sniff; returns the MIME type or null if not a known raster image. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return null
}

// ---------------------------------------------------------------- cache

interface CachedMeta {
  contentType: string
  url: string
  size: number
}

function cacheFiles(url: string): { data: string; meta: string } {
  const key = crypto.createHash('sha256').update(url).digest('hex')
  return { data: path.join(CACHE_DIR, key), meta: path.join(CACHE_DIR, `${key}.meta.json`) }
}

function readMeta(file: string): CachedMeta | null {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedMeta
    return typeof m.contentType === 'string' && m.contentType.startsWith('image/') ? m : null
  } catch {
    return null
  }
}

/** LRU by mtime (atime is unreliable on Windows); we touch mtime on every hit. */
export function pruneImageCache(maxBytes = MAX_CACHE_BYTES): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) return
    const files = fs
      .readdirSync(CACHE_DIR)
      .map(f => {
        const full = path.join(CACHE_DIR, f)
        try {
          const st = fs.statSync(full)
          return st.isFile() ? { full, size: st.size, mtime: st.mtimeMs } : null
        } catch {
          return null
        }
      })
      .filter((f): f is { full: string; size: number; mtime: number } => f !== null)
      .sort((a, b) => a.mtime - b.mtime)
    let total = files.reduce((s, f) => s + f.size, 0)
    for (const f of files) {
      if (total <= maxBytes) break
      try {
        fs.unlinkSync(f.full)
        total -= f.size
      } catch {
        // in use; skip
      }
    }
  } catch {
    // cache pruning is best-effort
  }
}

export function imageCacheStats(): { files: number; bytes: number; maxBytes: number } {
  let files = 0
  let bytes = 0
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      try {
        const st = fs.statSync(path.join(CACHE_DIR, f))
        if (st.isFile()) {
          files++
          bytes += st.size
        }
      } catch {
        // raced away
      }
    }
  } catch {
    // no cache dir yet
  }
  return { files, bytes, maxBytes: MAX_CACHE_BYTES }
}

export function clearImageCache(): number {
  let removed = 0
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      try {
        fs.unlinkSync(path.join(CACHE_DIR, f))
        removed++
      } catch {
        // in use; skip
      }
    }
  } catch {
    // no cache dir yet
  }
  return removed
}

// ---------------------------------------------------------------- fetch + serve

async function fetchWithManualRedirects(start: URL): Promise<globalThis.Response | null> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (!(await validateUrl(current))) return null
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      res.body?.cancel().catch(() => undefined)
      if (!loc || hop === MAX_REDIRECT_HOPS) return null
      let next: URL
      try {
        next = new URL(loc, current)
      } catch {
        return null
      }
      current = next // re-validated at the top of the next hop
      continue
    }
    return res
  }
  return null
}

/** Read the body with a hard byte cap; aborts the stream when exceeded. */
async function readCapped(res: globalThis.Response): Promise<Buffer | null> {
  const lenHeader = Number(res.headers.get('content-length') ?? 0)
  if (lenHeader > MAX_OBJECT_BYTES) {
    res.body?.cancel().catch(() => undefined)
    return null
  }
  if (!res.body) return null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_OBJECT_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function serveImage(req: Request, res: Response): Promise<void> {
  const raw = String(req.query.u ?? '')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    res.status(400).end()
    return
  }
  if (url.protocol !== 'https:' || !hostAllowed(url.hostname)) {
    res.status(403).end()
    return
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const { data: dataFile, meta: metaFile } = cacheFiles(url.href)
  const meta = readMeta(metaFile)
  if (meta && fs.existsSync(dataFile)) {
    const now = new Date()
    fs.utimes(dataFile, now, now, () => undefined) // LRU touch
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('Content-Type', meta.contentType)
    fs.createReadStream(dataFile).pipe(res)
    return
  }

  try {
    const upstream = await fetchWithManualRedirects(url)
    if (!upstream) {
      res.status(403).end()
      return
    }
    if (!upstream.ok) {
      upstream.body?.cancel().catch(() => undefined)
      res.status(502).end()
      return
    }
    const buf = await readCapped(upstream)
    if (!buf) {
      res.status(413).end()
      return
    }
    // Steam's UGC CDN serves images as application/octet-stream, so the upstream
    // header is unreliable. Sniff the magic bytes instead and only serve the
    // response when the bytes really are a known raster image — safer than
    // trusting either the header or the URL.
    const contentType = sniffImageType(buf)
    if (!contentType) {
      res.status(415).end()
      return
    }
    try {
      fs.writeFileSync(dataFile, buf)
      fs.writeFileSync(
        metaFile,
        JSON.stringify({ contentType, url: url.href, size: buf.length } satisfies CachedMeta),
      )
    } catch {
      // caching is best-effort; still serve the bytes
    }
    schedulePrune()
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('Content-Type', contentType)
    res.end(buf)
  } catch {
    res.status(502).end()
  }
}

let pruneTimer: NodeJS.Timeout | null = null
function schedulePrune(): void {
  if (pruneTimer) return
  pruneTimer = setTimeout(() => {
    pruneTimer = null
    pruneImageCache()
  }, 30_000)
  pruneTimer.unref()
}

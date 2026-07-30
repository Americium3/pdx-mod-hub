import fs from 'node:fs'
import { parseVdf, vdfChild } from '../vdf.js'
import type { AcfModEntry } from '../types.js'

export interface WorkshopScan {
  appId: number
  entries: AcfModEntry[]
  needsUpdate: boolean
  needsDownload: boolean
}

/**
 * Parse an appworkshop_<appId>.acf. Returns null on read/parse failure so the
 * caller can retry (Steam rewrites these files mid-download) and keep the last
 * good snapshot instead of emitting a false diff-to-empty.
 */
export function parseWorkshopAcf(appId: number, acfPath: string): WorkshopScan | null {
  let root
  try {
    root = parseVdf(fs.readFileSync(acfPath, 'utf8'))
  } catch {
    return null
  }
  const app = vdfChild(root, 'AppWorkshop')
  if (!app) return null
  const scan: WorkshopScan = {
    appId,
    entries: [],
    needsUpdate: app.NeedsUpdate === '1',
    needsDownload: app.NeedsDownload === '1',
  }

  const installed = vdfChild(app, 'WorkshopItemsInstalled') ?? {}
  const details = vdfChild(app, 'WorkshopItemDetails') ?? {}

  const num = (v: unknown): number => {
    const x = typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(x) ? x : 0
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

  const ids = new Set([...Object.keys(installed), ...Object.keys(details)])
  for (const id of ids) {
    if (!/^\d+$/.test(id)) continue
    const inst =
      typeof installed[id] === 'object' ? (installed[id] as Record<string, unknown>) : undefined
    const det =
      typeof details[id] === 'object' ? (details[id] as Record<string, unknown>) : undefined
    if (!inst && !det) continue
    scan.entries.push({
      id,
      appId,
      sizeOnDisk: num(inst?.size),
      installedTs: num(inst?.timeupdated),
      manifest: str(inst?.manifest),
      detailTs: num(det?.timeupdated),
      latestTimeupdated: num(det?.latest_timeupdated) || undefined,
      latestManifest: str(det?.latest_manifest),
    })
  }
  return scan
}

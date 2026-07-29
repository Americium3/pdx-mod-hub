import fs from 'node:fs'
import { parseVdf, vdfChild } from '../vdf.js'
import type { LocalMod } from '../types.js'

export interface WorkshopScan {
  appId: number
  mods: LocalMod[]
  needsUpdate: boolean
  needsDownload: boolean
}

export function parseWorkshopAcf(appId: number, acfPath: string): WorkshopScan {
  const scan: WorkshopScan = { appId, mods: [], needsUpdate: false, needsDownload: false }
  let root
  try {
    root = parseVdf(fs.readFileSync(acfPath, 'utf8'))
  } catch {
    return scan
  }
  const app = vdfChild(root, 'AppWorkshop')
  if (!app) return scan
  scan.needsUpdate = app.NeedsUpdate === '1'
  scan.needsDownload = app.NeedsDownload === '1'

  const installed = vdfChild(app, 'WorkshopItemsInstalled') ?? {}
  const details = vdfChild(app, 'WorkshopItemDetails') ?? {}

  const ids = new Set([...Object.keys(installed), ...Object.keys(details)])
  for (const id of ids) {
    if (!/^\d+$/.test(id)) continue
    const inst = typeof installed[id] === 'object' ? (installed[id] as Record<string, unknown>) : undefined
    const det = typeof details[id] === 'object' ? (details[id] as Record<string, unknown>) : undefined
    if (!inst && !det) continue
    const num = (v: unknown): number => {
      const x = typeof v === 'string' ? Number(v) : NaN
      return Number.isFinite(x) ? x : 0
    }
    scan.mods.push({
      id,
      appId,
      sizeBytes: num(inst?.size),
      timeUpdated: num(inst?.timeupdated) || num(det?.timeupdated),
      manifest: typeof inst?.manifest === 'string' ? (inst.manifest as string) : undefined,
      latestTimeUpdated: num(det?.latest_timeupdated) || undefined,
    })
  }
  return scan
}

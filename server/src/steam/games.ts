import fs from 'node:fs'
import path from 'node:path'
import { parseVdf, vdfChild } from '../vdf.js'
import type { GameInfo } from '../types.js'

export interface PdxGameDef {
  appId: number
  name: string
  short: string
  workshop: boolean
}

// Paradox-published Steam games. Workshop flags verified live 2026-07
// (store category 30 cross-checked against workshop hub content and local ACFs).
// Games where modding lives on Paradox Mods instead (CS2, Millennia, Empire of Sin,
// BATTLETECH) or with no mod platform at all (CK2, Vic2, HOI3) carry workshop: false;
// a present appworkshop ACF at runtime still wins over the static flag.
export const PDX_GAMES: PdxGameDef[] = [
  { appId: 1158310, name: 'Crusader Kings III', short: 'CK3', workshop: true },
  { appId: 236850, name: 'Europa Universalis IV', short: 'EU4', workshop: true },
  { appId: 3450310, name: 'Europa Universalis V', short: 'EU5', workshop: true },
  { appId: 394360, name: 'Hearts of Iron IV', short: 'HOI4', workshop: true },
  { appId: 281990, name: 'Stellaris', short: 'STE', workshop: true },
  { appId: 529340, name: 'Victoria 3', short: 'VIC3', workshop: true },
  { appId: 859580, name: 'Imperator: Rome', short: 'IMP', workshop: true },
  { appId: 233450, name: 'Prison Architect', short: 'PA', workshop: true },
  { appId: 464920, name: 'Surviving Mars', short: 'SM', workshop: true },
  { appId: 3215050, name: 'Surviving Mars: Relaunched', short: 'SMR', workshop: true },
  { appId: 255710, name: 'Cities: Skylines', short: 'CS1', workshop: true },
  { appId: 226840, name: 'Age of Wonders III', short: 'AOW3', workshop: true },
  { appId: 718850, name: 'Age of Wonders: Planetfall', short: 'AOWP', workshop: true },
  { appId: 1669000, name: 'Age of Wonders 4', short: 'AOW4', workshop: true },
  { appId: 1268590, name: 'Millennia', short: 'MIL', workshop: false },
  { appId: 203770, name: 'Crusader Kings II', short: 'CK2', workshop: false },
  { appId: 42960, name: 'Victoria II', short: 'VIC2', workshop: false },
  { appId: 949230, name: 'Cities: Skylines II', short: 'CS2', workshop: false },
  { appId: 604540, name: 'Empire of Sin', short: 'EOS', workshop: false },
  { appId: 637090, name: 'BATTLETECH', short: 'BT', workshop: false },
  { appId: 25890, name: 'Hearts of Iron III', short: 'HOI3', workshop: false },
]

export function scanGames(libraries: string[]): GameInfo[] {
  const games: GameInfo[] = []
  for (const def of PDX_GAMES) {
    const info: GameInfo = {
      appId: def.appId,
      name: def.name,
      short: def.short,
      workshop: def.workshop,
      installed: false,
      modCount: 0,
      updatesPending: 0,
    }
    for (const lib of libraries) {
      const steamapps = path.join(lib, 'steamapps')
      const manifest = path.join(steamapps, `appmanifest_${def.appId}.acf`)
      if (fs.existsSync(manifest)) {
        info.installed = true
        info.libraryPath = lib
        try {
          const root = parseVdf(fs.readFileSync(manifest, 'utf8'))
          const state = vdfChild(root, 'AppState')
          const dir = state && typeof state.installdir === 'string' ? state.installdir : undefined
          if (dir) info.installDir = path.join(steamapps, 'common', dir)
        } catch {
          // manifest unreadable: keep installed=true, skip installDir
        }
      }
      const acf = path.join(steamapps, 'workshop', `appworkshop_${def.appId}.acf`)
      if (fs.existsSync(acf)) {
        info.workshopAcf = acf
        if (!info.libraryPath) info.libraryPath = lib
      }
    }
    games.push(info)
  }
  return games
}

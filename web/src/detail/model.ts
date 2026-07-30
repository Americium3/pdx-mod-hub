// Detail-sheet view model: normalizes GET /api/mods/:id into one shape.
// The wire contract (web/src/types.ts) and the stage-A server payload differ
// slightly in field names (creator vs author, fileSize vs sizeWorkshop,
// timeCreatedTs vs timeCreated, favorited vs favorites, dependencies{} vs
// children[]/requiredBy[]); this module accepts both so the sheet works
// against either without touching shared files.
import type { StampState } from '../components/Stamp'
import type { BranchRange, ModDetail, ModSource, ModState } from '../types'

/** Stage-A server field spellings not present on the web wire type. */
interface RawDetailExtras {
  description?: unknown
  creator?: unknown
  timeCreatedTs?: unknown
  fileSize?: unknown
  favorited?: unknown
  lifetimeSubs?: unknown
  fetchStatus?: unknown
  dependencies?: { requires?: unknown; requiredBy?: unknown }
}

export interface NormalizedDetail {
  id: string
  appId: number
  title: string
  state: ModState
  source: ModSource
  previewUrl?: string
  dominantColor?: string
  /** server-sanitized HTML — the ONLY field ever rendered via innerHTML */
  descriptionHtml?: string
  /** raw text/BBCode fallback — rendered as plain text only, never as HTML */
  descriptionText?: string
  tags: string[]
  timeCreated?: number
  remoteTs?: number
  acfTs?: number
  sizeWorkshop?: number
  sizeOnDisk?: number
  subs?: number
  favorites?: number
  views?: number
  score?: number
  voteCount?: number
  author?: string
  authorUrl?: string
  authorAvatarUrl?: string
  children: string[]
  requiredBy: string[]
  dlcRequired: { appId: number; name?: string }[]
  branchRange?: BranchRange
  accountAsOf?: number
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

export function normalizeDetail(d: ModDetail): NormalizedDetail {
  const raw = d as ModDetail & RawDetailExtras
  const votesUp = num(raw.votesUp)
  const votesDown = num(raw.votesDown)
  const voteCount =
    num(raw.voteCount) ??
    (votesUp !== undefined && votesDown !== undefined ? votesUp + votesDown : undefined)
  return {
    id: d.id,
    appId: d.appId,
    title: d.title,
    state: d.state,
    source: d.source,
    previewUrl: str(raw.previewUrl),
    dominantColor: str(raw.dominantColor),
    descriptionHtml: str(raw.descriptionHtml),
    descriptionText: str(raw.description),
    tags: idList(raw.tags),
    timeCreated: num(raw.timeCreated) ?? num(raw.timeCreatedTs),
    remoteTs: num(raw.remoteTs),
    acfTs: num(raw.acfTs),
    sizeWorkshop: num(raw.sizeWorkshop) ?? num(raw.fileSize),
    sizeOnDisk: num(raw.sizeOnDisk),
    subs: num(raw.subs),
    favorites: num(raw.favorites) ?? num(raw.favorited),
    views: num(raw.views),
    score: num(raw.score),
    voteCount,
    author: str(raw.author) ?? str(raw.creator),
    authorUrl: str(raw.authorUrl),
    authorAvatarUrl: str(raw.authorAvatarUrl),
    children: idList(raw.children).length > 0 ? idList(raw.children) : idList(raw.dependencies?.requires),
    requiredBy:
      idList(raw.requiredBy).length > 0 ? idList(raw.requiredBy) : idList(raw.dependencies?.requiredBy),
    dlcRequired: Array.isArray(raw.dlcRequired)
      ? raw.dlcRequired.filter(x => x && typeof x.appId === 'number')
      : [],
    branchRange: raw.branchRange ?? undefined,
    accountAsOf: num(raw.accountAsOf),
  }
}

/* ---------- Stamp mapping ---------- */

/** Hero stamp for a detail sheet; null = no stamp (not-installed / error). */
export function stampStateOf(state: ModState): StampState | null {
  switch (state) {
    case 'awaiting-steam':
      return 'awaiting'
    case 'queued-for-launch':
      return 'queued'
    case 'downloading':
      return 'downloading'
    case 'up-to-date':
      return 'fetched'
    case 'removed':
      return 'removed'
    case 'banned':
      return 'banned'
    case 'orphaned':
      return 'orphaned'
    case 'unverified':
      return 'unverified'
    default:
      return null
  }
}

/* ---------- External URLs ---------- */

export function workshopPageUrl(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(id)}`
}

export function steamPageUrl(id: string): string {
  return `steam://url/CommunityFilePage/${encodeURIComponent(id)}`
}

export function steamRunUrl(appId: number): string {
  return `steam://run/${appId}`
}

/** Profile link: explicit authorUrl wins; else build from a SteamID64. */
export function profileUrlOf(author?: string, authorUrl?: string): string | undefined {
  if (authorUrl) return authorUrl
  if (author && /^\d{10,20}$/.test(author)) {
    return `https://steamcommunity.com/profiles/${author}`
  }
  return undefined
}

/** Only inject dominant colors that are plain hex — never arbitrary CSS. */
export function safeCssColor(c: string | undefined): string | undefined {
  return c && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : undefined
}

/* ---------- Prose container ----------
   Styling for server-sanitized description/changelog HTML. Links inherit the
   app's global anchor styling (accent text, hover underline) from index.css. */
export const PROSE_CLASS =
  'voice-ui break-words text-[var(--text-2)] ' +
  '[&_p]:my-[8px] [&_p:first-child]:mt-0 ' +
  '[&_ul]:my-[8px] [&_ul]:list-disc [&_ul]:pl-[18px] ' +
  '[&_ol]:my-[8px] [&_ol]:list-decimal [&_ol]:pl-[18px] ' +
  '[&_li]:my-[2px] ' +
  '[&_img]:my-[8px] [&_img]:max-w-full [&_img]:rounded-std ' +
  '[&_h1]:mt-[14px] [&_h1]:mb-[6px] [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-[var(--text-1)] ' +
  '[&_h2]:mt-[12px] [&_h2]:mb-[4px] [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--text-1)] ' +
  '[&_h3]:mt-[10px] [&_h3]:mb-[4px] [&_h3]:text-[13px] [&_h3]:font-medium [&_h3]:text-[var(--text-1)] ' +
  '[&_blockquote]:my-[8px] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line-2)] [&_blockquote]:pl-[10px] [&_blockquote]:text-[var(--text-3)] ' +
  '[&_code]:font-mono [&_code]:text-[12px] ' +
  '[&_pre]:my-[8px] [&_pre]:overflow-x-auto [&_pre]:rounded-std [&_pre]:bg-[var(--inset)] [&_pre]:p-[8px] [&_pre]:font-mono [&_pre]:text-[12px]'

// Lazy 2-line changelog excerpt -> EXPAND spring to full entries with
// "No notes provided" fallback and before_ts cursor loading (DESIGN_SPEC §5/6).
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../../api'
import { Skeleton } from '../../components/Skeleton'
import { EXPAND, useReducedMotionSafe } from '../../motion'
import { useHub } from '../../store'
import type { ChangelogEntry } from '../../types'
import { absDateTime } from '../../util'

interface CacheRecord {
  entries: ChangelogEntry[]
  hasMore: boolean
  unavailable: boolean
}

/** Module-level cache: several feed events can point at the same mod. */
const cache = new Map<string, CacheRecord>()
const inFlight = new Map<string, Promise<CacheRecord>>()

function fetchHead(modId: string): Promise<CacheRecord> {
  const cached = cache.get(modId)
  if (cached) return Promise.resolve(cached)
  const pending = inFlight.get(modId)
  if (pending) return pending
  const p = api
    .changelog(modId, undefined, 20)
    .then(page => {
      const rec: CacheRecord = {
        entries: page.entries,
        hasMore: page.hasMore,
        unavailable: page.status === 'unavailable' || page.status === 'error',
      }
      cache.set(modId, rec)
      return rec
    })
    .finally(() => inFlight.delete(modId))
  inFlight.set(modId, p)
  return p
}

/** Plain-text excerpt from sanitized entry HTML (safe: tags stripped for clamping). */
function excerptText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function EntryBody({ entry }: { entry: ChangelogEntry }): ReactNode {
  const { t } = useHub()
  const text = excerptText(entry.html)
  if (!text) {
    return <p className="text-[13px] italic text-[var(--text-3)]">{t('updates.noNotes')}</p>
  }
  // Server-sanitized HTML only (BBCode whitelist + DOMPurify before caching).
  return (
    <div
      className="changelog-prose text-[13px] leading-[1.5] text-[var(--text-2)] [&_a]:text-[var(--accent-text)] [&_code]:font-mono [&_code]:text-[12px] [&_li]:ml-[16px] [&_li]:list-disc [&_p]:mb-[6px]"
      dangerouslySetInnerHTML={{ __html: entry.html }}
    />
  )
}

export function ChangelogBlock({
  modId,
  active,
}: {
  modId: string
  /** lazy gate — only fetch once the card scrolled into view */
  active: boolean
}): ReactNode {
  const { t, lang } = useHub()
  const expand = useReducedMotionSafe(EXPAND)
  const [record, setRecord] = useState<CacheRecord | null>(() => cache.get(modId) ?? null)
  const [open, setOpen] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  useEffect(() => {
    if (!active || record) return
    let alive = true
    fetchHead(modId)
      .then(rec => {
        if (alive) setRecord(rec)
      })
      .catch(() => {
        if (alive) setRecord({ entries: [], hasMore: false, unavailable: true })
      })
    return () => {
      alive = false
    }
  }, [active, record, modId])

  const loadOlder = useCallback(() => {
    const rec = cache.get(modId)
    if (!rec || !rec.hasMore || loadingOlder) return
    const oldest = rec.entries[rec.entries.length - 1]
    if (!oldest) return
    setLoadingOlder(true)
    api
      .changelog(modId, oldest.ts, 20)
      .then(page => {
        const seen = new Set(rec.entries.map(e => `${e.ts}:${e.ord}`))
        const merged = [...rec.entries, ...page.entries.filter(e => !seen.has(`${e.ts}:${e.ord}`))]
        const next: CacheRecord = {
          entries: merged,
          hasMore: page.hasMore,
          unavailable: page.status === 'unavailable' || page.status === 'error',
        }
        cache.set(modId, next)
        setRecord(next)
      })
      .catch(() => undefined)
      .finally(() => setLoadingOlder(false))
  }, [modId, loadingOlder])

  if (!record) {
    return (
      <div className="px-[16px] pb-[4px]">
        <Skeleton height={11} width="72%" radius={2} />
      </div>
    )
  }

  if (record.unavailable && record.entries.length === 0) {
    return (
      <div className="voice-mono-sm px-[16px] pb-[4px] text-[var(--text-3)]">
        {t('misc.changelogUnavailable')}
      </div>
    )
  }

  const head = record.entries[0]
  const headText = head ? excerptText(head.html) : ''

  return (
    <div className="px-[16px]">
      {/* Collapsed: 2-line excerpt; the row toggles the EXPAND spring. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={open ? t('updates.collapse') : t('updates.expand')}
        className="group/cl flex w-full cursor-pointer items-start gap-[8px] text-left"
      >
        <span className="min-w-0 flex-1">
          {!open ? (
            head && headText ? (
              <span
                className="block overflow-hidden text-[13px] leading-[1.5] text-[var(--text-2)]"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {headText}
              </span>
            ) : (
              <span className="block text-[13px] italic leading-[1.5] text-[var(--text-3)]">
                {t('updates.noNotes')}
              </span>
            )
          ) : (
            <span className="voice-label block leading-[18px]">{t('updates.changelog')}</span>
          )}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={expand}
          className="mt-[2px] shrink-0 text-[var(--text-3)] group-hover/cl:text-[var(--text-2)]"
          aria-hidden="true"
        >
          <ChevronDown size={16} strokeWidth={1.75} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="entries"
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: { height: expand, opacity: { duration: 0.14, delay: 0.06 } },
            }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-[12px] pt-[10px]">
              {record.entries.map(entry => (
                <div key={`${entry.ts}:${entry.ord}`} className="flex flex-col gap-[4px]">
                  <div className="voice-mono-sm text-[var(--text-3)]">
                    {t('updates.entry.update', { t: absDateTime(lang, entry.ts) })}
                  </div>
                  <EntryBody entry={entry} />
                </div>
              ))}

              {record.entries.length === 0 ? (
                <p className="text-[13px] italic text-[var(--text-3)]">{t('updates.noNotes')}</p>
              ) : null}

              {record.unavailable && record.entries.length > 0 ? (
                <div className="voice-mono-sm text-[var(--text-3)]">
                  {t('misc.changelogUnavailable')}
                </div>
              ) : null}

              {record.hasMore ? (
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="voice-mono-sm cursor-pointer self-start text-[var(--accent-text)] hover:underline disabled:opacity-40"
                >
                  {loadingOlder ? t('misc.loading') : t('updates.loadOlder')}
                </button>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

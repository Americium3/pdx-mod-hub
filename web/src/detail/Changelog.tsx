// Changelog tab: cursor-paginated (before_ts, never ?page=) per API_AMENDMENTS.
// Mono "Update: <datetime>" headers, server-sanitized bodies, "No notes
// provided" for empty prose, ghost "Older entries" button loads more.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Button } from '../components/Button'
import { ReservedText } from '../components/ReservedText'
import { Skeleton } from '../components/Skeleton'
import { useHub } from '../store'
import type { ChangelogEntry } from '../types'
import { absDateTime } from '../util'
import { PROSE_CLASS } from './model'

const PAGE_SIZE = 20

export function ChangelogTab({ modId }: { modId: string }): ReactNode {
  const { t, lang } = useHub()
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let alive = true
    setEntries([])
    setHasMore(false)
    setUnavailable(false)
    setLoading(true)
    api
      .changelog(modId, undefined, PAGE_SIZE)
      .then(page => {
        if (!alive) return
        setEntries(page.entries)
        setHasMore(page.hasMore)
        setUnavailable(page.status === 'unavailable')
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setUnavailable(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [modId])

  const loadMore = useCallback(() => {
    const last = entries[entries.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    api
      .changelog(modId, last.ts, PAGE_SIZE)
      .then(page => {
        setEntries(prev => {
          const seen = new Set(prev.map(e => `${e.ts}:${e.ord}`))
          return [...prev, ...page.entries.filter(e => !seen.has(`${e.ts}:${e.ord}`))]
        })
        setHasMore(page.hasMore)
        setUnavailable(page.status === 'unavailable')
        setLoadingMore(false)
      })
      .catch(() => {
        setUnavailable(true)
        setLoadingMore(false)
      })
  }, [modId, entries, loadingMore])

  if (loading) {
    return (
      <div className="flex flex-col gap-[10px] pt-[10px]" aria-hidden="true">
        <Skeleton height={12} width="42%" radius={2} />
        <Skeleton height={10} width="90%" radius={2} />
        <Skeleton height={10} width="72%" radius={2} />
        <Skeleton height={12} width="38%" radius={2} className="mt-[10px]" />
        <Skeleton height={10} width="80%" radius={2} />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="pt-[10px] text-[13px] text-[var(--text-3)]">
        {unavailable ? t('misc.changelogUnavailable') : t('updates.noNotes')}
      </p>
    )
  }

  return (
    <div className="flex flex-col">
      {entries.map(e => (
        <article
          key={`${e.ts}:${e.ord}`}
          className="border-b border-[var(--line-div)] py-[10px] last:border-b-0"
        >
          <header className="voice-mono text-[var(--text-1)]">
            {t('updates.entry.update', { t: absDateTime(lang, e.ts) })}
          </header>
          {e.html ? (
            // Server-sanitized at fetch time BEFORE caching (API_AMENDMENTS §CHANGELOG).
            <div className={PROSE_CLASS} dangerouslySetInnerHTML={{ __html: e.html }} />
          ) : (
            <p className="mt-[4px] text-[13px] text-[var(--text-3)] italic">
              {t('updates.noNotes')}
            </p>
          )}
        </article>
      ))}
      {unavailable ? (
        <p className="py-[8px] text-[12px] text-[var(--text-3)]">
          {t('misc.changelogUnavailable')}
        </p>
      ) : null}
      {hasMore ? (
        <div className="py-[10px]">
          <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t('misc.loading') : <ReservedText k="updates.loadOlder" center />}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

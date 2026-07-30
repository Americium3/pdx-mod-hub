// Browse data hook: POST /api/browse/:appId {q, sort, page} (POST because the
// endpoint spawns the Steam helper — never a cacheable GET). 50/page append
// pagination up to capped:true; stale responses are discarded by sequence.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { watchPersonas } from '../../personas'
import type { BrowseItem, BrowseSort } from '../../types'

export interface BrowseData {
  items: BrowseItem[]
  /** total result count when the server reports one */
  total: number | undefined
  /** server stopped at its pagination cap — no further pages */
  capped: boolean
  /** initial page load in flight (items are cleared) */
  loading: boolean
  /** an append (Load 50 more) in flight */
  loadingMore: boolean
  /** at least one successful fetch for the CURRENT query */
  loaded: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  /** re-run whichever fetch failed (initial or append) */
  retry: () => void
}

export function useBrowse(
  appId: number | null,
  enabled: boolean,
  q: string,
  sort: BrowseSort,
): BrowseData {
  const [items, setItems] = useState<BrowseItem[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [capped, setCapped] = useState(false)
  const [endReached, setEndReached] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** last successfully fetched page number */
  const pageRef = useRef(0)
  /** monotonically increasing request id — stale responses are dropped */
  const seqRef = useRef(0)
  /** what to re-run when Retry is pressed */
  const failedRef = useRef<{ page: number; append: boolean } | null>(null)

  const fetchPage = useCallback(
    (page: number, append: boolean): void => {
      if (appId === null || !enabled) return
      const mySeq = ++seqRef.current
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setError(null)
      }
      void (async () => {
        try {
          const body: { q?: string; sort: BrowseSort; page: number } = { sort, page }
          if (q) body.q = q
          const res = await api.browse(appId, body)
          if (seqRef.current !== mySeq) return
          failedRef.current = null
          pageRef.current = res.page
          setItems(prev => (append ? [...prev, ...res.items] : res.items))
          setTotal(res.total)
          setCapped(res.capped)
          setEndReached(res.items.length < res.perPage)
          setLoaded(true)
          setError(null)
        } catch (e) {
          if (seqRef.current !== mySeq) return
          failedRef.current = { page, append }
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          if (seqRef.current === mySeq) {
            setLoading(false)
            setLoadingMore(false)
          }
        }
      })()
    },
    [appId, enabled, q, sort],
  )

  // Reset + fetch page 1 whenever the query identity (game / q / sort) changes.
  useEffect(() => {
    seqRef.current++ // invalidate any in-flight request for the old query
    pageRef.current = 0
    failedRef.current = null
    setItems([])
    setTotal(undefined)
    setCapped(false)
    setEndReached(false)
    setLoaded(false)
    setLoading(false)
    setLoadingMore(false)
    setError(null)
    fetchPage(1, false)
  }, [fetchPage])

  // Persona names resolve asynchronously server-side; re-ask a few times and
  // merge whatever lands. apply is skipped when the response is empty, and the
  // setter returns prev unchanged when nothing merges, so this cannot loop.
  // Known-missing profiles settle to an empty-string sentinel ('' renders as
  // absent) so they leave the re-ask set and free slots in the 100-id cap.
  useEffect(() => {
    const missing = items.filter(i => i.ownerId && i.author == null).map(i => i.ownerId)
    if (missing.length === 0) return
    return watchPersonas(missing, (personas, knownMissing) => {
      const settled = new Set(knownMissing ?? [])
      setItems(prev => {
        let changed = false
        const next = prev.map(it => {
          if (!it.ownerId || it.author != null) return it
          const p = personas[it.ownerId]
          if (p) {
            changed = true
            return { ...it, author: p.name, authorAvatarUrl: p.avatarUrl }
          }
          if (settled.has(it.ownerId)) {
            changed = true
            return { ...it, author: '' }
          }
          return it
        })
        return changed ? next : prev
      })
    })
  }, [items])

  const loadMore = useCallback(() => {
    fetchPage(Math.max(1, pageRef.current) + 1, true)
  }, [fetchPage])

  const retry = useCallback(() => {
    const failed = failedRef.current
    if (failed) fetchPage(failed.page, failed.append)
    else fetchPage(1, false)
  }, [fetchPage])

  const hasMore =
    !capped &&
    !endReached &&
    items.length > 0 &&
    !(total !== undefined && items.length >= total)

  return { items, total, capped, loading, loadingMore, loaded, error, hasMore, loadMore, retry }
}

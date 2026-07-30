// Mission-log feed loading: initial page, after_seq live catch-up (SSE-driven
// via the store's feedPulse), before_seq infinite scroll-back.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { useHub } from '../../store'
import type { FeedEvent } from '../../types'

export interface FeedData {
  /** newest-first by ts (time_updated), seq tiebreak */
  events: FeedEvent[]
  loaded: boolean
  failed: boolean
  hasMore: boolean
  loadingMore: boolean
  /** seqs of events that arrived live over SSE (glide + stamp thunk) */
  freshSeqs: ReadonlySet<number>
  /** seq -> stagger index for the first 5 cards on route entry */
  entranceIndex: ReadonlyMap<number, number>
  loadOlder: () => void
  retry: () => void
}

function sortFeed(events: FeedEvent[]): FeedEvent[] {
  return [...events].sort((a, b) => (b.ts - a.ts !== 0 ? b.ts - a.ts : b.seq - a.seq))
}

function mergeBySeq(existing: FeedEvent[], incoming: FeedEvent[]): FeedEvent[] {
  const map = new Map<number, FeedEvent>()
  for (const e of existing) map.set(e.seq, e)
  for (const e of incoming) map.set(e.seq, e)
  return sortFeed([...map.values()])
}

const PAGE = 50
const ENTRANCE_COUNT = 5

export function useFeed(): FeedData {
  const { feedPulse } = useHub()
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [freshSeqs, setFreshSeqs] = useState<ReadonlySet<number>>(new Set())

  const entranceIndex = useRef<Map<number, number>>(new Map())
  const maxSeq = useRef(0)
  const minSeq = useRef(Infinity)
  const initialized = useRef(false)
  const catchingUp = useRef(false)
  const scrollingBack = useRef(false)

  const trackCursors = (list: FeedEvent[]): void => {
    for (const e of list) {
      if (e.seq > maxSeq.current) maxSeq.current = e.seq
      if (e.seq < minSeq.current) minSeq.current = e.seq
    }
  }

  const loadInitial = useCallback(() => {
    api
      .feed({ limit: PAGE })
      .then(page => {
        trackCursors(page.events)
        const sorted = sortFeed(page.events)
        // Stagger only the first 5 on ROUTE ENTRY, keyed by event id (seq).
        entranceIndex.current = new Map(
          sorted.slice(0, ENTRANCE_COUNT).map((e, i) => [e.seq, i]),
        )
        setEvents(sorted)
        setHasMore(page.hasMore)
        setFailed(false)
        setLoaded(true)
        initialized.current = true
      })
      .catch(() => {
        setFailed(true)
        setLoaded(true)
      })
  }, [])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  const retry = useCallback(() => {
    setLoaded(false)
    setFailed(false)
    loadInitial()
  }, [loadInitial])

  // Live catch-up on every feed poke / SSE (re)open.
  useEffect(() => {
    if (!initialized.current || catchingUp.current) return
    catchingUp.current = true
    api
      .feed({ afterSeq: maxSeq.current, limit: PAGE })
      .then(page => {
        if (page.events.length === 0) return
        const newSeqs = page.events
          .filter(e => e.seq > maxSeq.current)
          .map(e => e.seq)
        trackCursors(page.events)
        setEvents(prev => mergeBySeq(prev, page.events))
        if (newSeqs.length > 0) {
          setFreshSeqs(prev => {
            const next = new Set(prev)
            for (const s of newSeqs) next.add(s)
            return next
          })
        }
      })
      .catch(() => undefined)
      .finally(() => {
        catchingUp.current = false
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedPulse])

  const loadOlder = useCallback(() => {
    if (!initialized.current || scrollingBack.current || !hasMore) return
    scrollingBack.current = true
    setLoadingMore(true)
    api
      .feed({ beforeSeq: minSeq.current === Infinity ? undefined : minSeq.current, limit: PAGE })
      .then(page => {
        trackCursors(page.events)
        setEvents(prev => mergeBySeq(prev, page.events))
        setHasMore(page.hasMore)
      })
      .catch(() => undefined)
      .finally(() => {
        scrollingBack.current = false
        setLoadingMore(false)
      })
  }, [hasMore])

  return {
    events,
    loaded,
    failed,
    hasMore,
    loadingMore,
    freshSeqs,
    entranceIndex: entranceIndex.current,
    loadOlder,
    retry,
  }
}

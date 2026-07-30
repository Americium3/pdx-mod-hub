import type { Response } from 'express'
import { currentSeq } from './events.js'

// SSE is a poke-only channel: default-type messages {type: state|feed|action, seq}
// with id: = seq (Last-Event-ID compatible) and a 25s heartbeat comment. On every
// 'open' the client refetches /api/state and /api/feed?after_seq=<lastSeen>.

const clients = new Set<Response>()
const MAX_CLIENTS = 32

export function addClient(res: Response): void {
  if (clients.size >= MAX_CLIENTS) {
    res.status(503).json({ error: 'too many event stream clients' })
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const seq = currentSeq()
  res.write(`: connected\n\nid: ${seq}\ndata: ${JSON.stringify({ type: 'state', seq })}\n\n`)
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

export type PokeType = 'state' | 'feed' | 'action'

export function broadcastPoke(type: PokeType, extra?: Record<string, unknown>): void {
  const seq = currentSeq()
  send(`id: ${seq}\ndata: ${JSON.stringify({ type, seq, ...extra })}\n\n`)
}

// Legacy named-event channel; still used by the helper module until stage B lands.
export function broadcast(event: string, data: unknown): void {
  send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function send(payload: string): void {
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

setInterval(() => send(': hb\n\n'), 25_000).unref()

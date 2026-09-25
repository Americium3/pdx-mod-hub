/**
 * fetch() plus the body read under one hard deadline. The timer aborts the
 * request (tearing down the socket) and rejects the race on its own, so the
 * returned promise settles on time even if the abort never reaches fetch.
 *
 * Why not just `signal: AbortSignal.timeout(ms)`: on 2026-09-24 a poll sat on
 * a GetPublishedFileDetails fetch carrying exactly that for 12 hours, with no
 * socket left open. That could not be reproduced afterwards, so this does not
 * rely on undici honouring the abort at all.
 */
export async function fetchWithDeadline<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const ac = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DOMException(`request timed out after ${timeoutMs}ms`, 'TimeoutError')
      ac.abort(err)
      reject(err)
    }, timeoutMs)
  })
  const work = (async () => read(await fetch(url, { ...init, signal: ac.signal })))()
  try {
    // Promise.race subscribes to both, so whichever loses never surfaces as an
    // unhandled rejection.
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

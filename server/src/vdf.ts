// Tolerant parser for Valve KeyValues text (VDF/ACF files).
export type VdfNode = { [key: string]: string | VdfNode }

export function parseVdf(text: string): VdfNode {
  let i = 0
  const n = text.length

  function skipWs(): void {
    while (i < n) {
      const c = text[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++
      else if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++
      } else break
    }
  }

  function readToken(): string | null {
    skipWs()
    if (i >= n) return null
    const c = text[i]
    if (c === '{' || c === '}') {
      i++
      return c
    }
    if (c === '"') {
      i++
      let out = ''
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          out += text[i + 1]
          i += 2
        } else {
          out += text[i++]
        }
      }
      i++
      return out
    }
    let out = ''
    while (i < n && !' \t\r\n{}"'.includes(text[i])) out += text[i++]
    return out
  }

  function parseBlock(): VdfNode {
    const node: VdfNode = {}
    for (;;) {
      const key = readToken()
      if (key === null || key === '}') return node
      const val = readToken()
      if (val === null) return node
      if (val === '{') node[key] = parseBlock()
      else node[key] = val
    }
  }

  return parseBlock()
}

export function vdfChild(node: VdfNode | undefined, ...keys: string[]): VdfNode | undefined {
  if (!node) return undefined
  for (const key of keys) {
    const hit = node[key] ?? node[key.toLowerCase()] ?? node[key.toUpperCase()]
    if (hit && typeof hit === 'object') return hit
  }
  return undefined
}

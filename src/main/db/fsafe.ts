import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'

/**
 * Crash-safe JSON persistence primitives. A bare writeFileSync torn mid-write
 * (power loss, crash, force-kill) corrupts the file, and a corrupt read must
 * not silently reset the store to empty — that loses every chat, mission and
 * setting. Writes go tmp→rename (atomic on the same volume) with the previous
 * good file kept as .bak; reads fall back to .bak and quarantine the corrupt
 * original as .corrupt for inspection.
 */

export function atomicWrite(filePath: string, contents: string): void {
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, contents, 'utf8')
  try {
    if (existsSync(filePath)) copyFileSync(filePath, filePath + '.bak')
  } catch {
    // a failed backup must not block the write itself
  }
  renameSync(tmp, filePath) // atomic replace — readers see old or new, never torn
}

export function loadJson<T>(filePath: string): T | null {
  for (const p of [filePath, filePath + '.bak']) {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T
    } catch {
      if (p === filePath && existsSync(p)) {
        console.log('[nori-store] corrupt or unreadable:', p, '— falling back to .bak')
        try {
          copyFileSync(p, p + '.corrupt')
        } catch {
          // quarantine is best-effort
        }
      }
    }
  }
  return null
}

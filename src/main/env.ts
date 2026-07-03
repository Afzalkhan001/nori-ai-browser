import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Minimal .env loader for the main process — avoids a dotenv dependency.
 * The OpenAI key lives ONLY here; it is never sent over IPC or exposed
 * to any renderer/web content.
 */
export function loadEnv(): void {
  for (const dir of [process.cwd(), join(__dirname, '../..')]) {
    try {
      const text = readFileSync(join(dir, '.env'), 'utf8')
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (m && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
      return
    } catch {
      // try next location
    }
  }
}

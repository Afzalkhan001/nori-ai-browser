import { app, BrowserWindow, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'

/** Very small markdown → HTML for PDF reports (headings, bold, lists, links, paragraphs). */
function mdToHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  const out: string[] = []
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`)
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s|^\s*([-*]|\d+\.)\s/.test(lines[i])) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  return out.join('\n')
}

function reportHtml(title: string, bodyMd: string): string {
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 24mm 20mm; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; color: #21211d; font-size: 12.5px; line-height: 1.7; }
    .kicker { font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: #918f85; }
    h1 { font-family: Georgia, serif; font-style: italic; font-weight: 400; font-size: 30px; margin: 10px 0 4px; }
    h1 .dot { color: #34503e; font-style: normal; }
    .rule { border: 0; border-top: 1px solid rgba(33,33,29,0.15); margin: 18px 0 22px; }
    h2, h3, h4 { font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #34503e; margin: 22px 0 6px; font-weight: 600; }
    p { margin: 6px 0; }
    ul { margin: 6px 0; padding-left: 16px; }
    li { margin: 3px 0; }
    a { color: #34503e; }
    code { background: #efebe1; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
    strong { font-weight: 600; }
    .foot { margin-top: 34px; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #b3b1a6; }
  </style></head><body>
    <div class="kicker">${date} — Prepared by Nori</div>
    <h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}<span class="dot">.</span></h1>
    <hr class="rule" />
    ${mdToHtml(bodyMd)}
    <div class="foot">Nori — your AI teammate</div>
  </body></html>`
}

/** Render markdown into an A4 PDF in Downloads; returns the saved path. */
export async function savePdf(title: string, markdown: string): Promise<string> {
  const html = reportHtml(title, markdown)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64'))
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
    const safe = title.replace(/[<>:"/\\|?*]+/g, '').slice(0, 60).trim() || 'Nori Report'
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const file = join(app.getPath('downloads'), `${safe} — ${stamp}.pdf`)
    writeFileSync(file, pdf)
    shell.showItemInFolder(file)
    return file
  } finally {
    win.destroy()
  }
}

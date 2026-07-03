import React from 'react'

/**
 * Minimal markdown → React for AI output. Handles: ## headings, **bold**,
 * *italic*, `code`, ``` blocks, - / 1. lists, links, paragraphs.
 * Deliberately tiny — no dependency, no HTML injection (everything is text nodes).
 */

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // tokens: `code`, **bold**, *italic*, [label](url)
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      out.push(
        <code key={key} className="rounded bg-ink-900/[0.06] px-1 py-0.5 font-mono text-[11.5px] text-moss-900">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**')) {
      out.push(
        <strong key={key} className="font-semibold text-ink-900">
          {tok.slice(2, -2)}
        </strong>
      )
    } else if (tok.startsWith('[')) {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)
      const href = mm?.[2] ?? ''
      out.push(
        <button
          key={key}
          onClick={() => href.startsWith('http') && window.nori.tabs.create(href)}
          className="cursor-pointer text-moss-600 underline decoration-moss-600/40 underline-offset-2 transition-colors hover:text-moss-500"
          title={href}
        >
          {mm?.[1] ?? tok}
        </button>
      )
    } else {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) buf.push(lines[i++])
      i++ // closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-lg bg-[#1e2420] p-3 font-mono text-[11px] leading-[1.6] text-[#cfe0d4]"
        >
          {buf.join('\n')}
        </pre>
      )
      continue
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      blocks.push(
        <div key={key++} className="micro-label mt-4 mb-1.5 first:mt-0 !text-moss-700">
          {h[2]}
        </div>
      )
      i++
      continue
    }

    // list (bulleted or numbered)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="my-1.5 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2">
              <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-moss-600" />
              <span className="min-w-0">{inline(it, `${key}-${j}`)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // blank line
    if (!line.trim()) {
      i++
      continue
    }

    // paragraph — swallow consecutive non-empty plain lines
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push(
      <p key={key++} className="my-1.5 first:mt-0 last:mb-0">
        {inline(buf.join(' '), `p${key}`)}
      </p>
    )
  }

  return <div className="select-text text-[13px] leading-[1.7]">{blocks}</div>
}

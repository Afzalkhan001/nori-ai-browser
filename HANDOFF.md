# Nori — Full Context Handoff

> Paste this whole file into a new chat to continue. It is the single source of truth for what Nori is, what's built, how it works, and what's next.

---

## 1. What Nori is
Nori is an **AI-native productivity browser** (founder: Afzal Khan). It's a real Electron browser where an AI sidebar can chat with pages, analyze sites, generate prompts, write content, extract data to CSV, remember everything you read, run standing "missions," fact-check articles, and **autonomously comment on social posts** with human approval.

**Hard constraint:** the ONLY paid resource is an **OpenAI API key** (in `.env` at project root — user rotates it; may need a fresh one pasted in). No cloud infra, no other paid APIs. `gpt-4o-mini` for cheap/frequent, `gpt-4o` for research/synthesis, `text-embedding-3-small` for memory.

**Project path:** `C:\Users\DELL\OneDrive\Desktop\nori web browser`
**Run:** `npm run dev` (electron-vite). Typecheck: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`.
**Note:** Main-process changes require a full app restart (kill electron, `npm run dev`) — the renderer HMRs but main does not.

---

## 2. Tech stack & architecture
- **Electron** (frameless window, custom titlebar) + **electron-vite**.
- **Renderer:** React 18 + TypeScript + Tailwind v4 + Zustand.
- **Tabs:** one `WebContentsView` per tab (`src/main/tabs.ts`), positioned over a renderer-drawn rounded "canvas" (Arc-style floating frame).
- **AI logic:** all in main process under `src/main/ai-engine/` (the future FastAPI seam — deliberately no Python backend yet).
- **Storage:** local JSON file in userData via `src/main/db/store.ts` (swappable for SQLite behind the same API; native-build risk on this Windows machine made JSON the pragmatic choice). Vectors live in a separate `recall.json`.
- **IPC:** typed contract in `src/shared/types.ts`; preload bridge in `src/preload/index.ts` exposes `window.nori.*`.
- **Design language (STRONG user preference):** luxury-editorial — porcelain/ink/moss palette, serif-italic accents, hairline borders, micro-labels, NO chat bubbles (transcript layout), slow `cubic-bezier(0.22,1,0.36,1)` motion. References: luxury-places.ch, live-up.co.jp. The user rejected generic "dark glassy AI" UI early on — do not regress to that.

### Key files
```
src/main/
  index.ts            app bootstrap, protocol reg, UA override, starts watcher+missions+blocker
  tabs.ts             TabManager (WebContentsView per tab), OAuth popup handling, YT ad-skip, cookie dismiss, Recall capture hook
  ipc.ts              all IPC handlers
  startpage.ts        nori://home editorial new-tab page
  blocker.ts          ad/tracker blocker (session.webRequest domain list)
  watcher.ts          scheduled topic watches (30-min Google News checks, hidden window)
  missions.ts         scheduled "standing goal" runner (hidden-window mini agent)
  pdf.ts              markdown -> styled A4 PDF (printToPDF)
  db/store.ts         JSON store: messages, costLog, settings, watches, artifacts, playbooks, missions
  ai-engine/
    openai.ts         client, streamChat (tool-calling), completeChat, embed, model routing, cost
    cost.ts           pricing, token estimate, trim, cost logging
    chat.ts           THE AGENT LOOP (system prompt, tools orchestration, approval gate, batch guarantee)
    agent.ts          tool defs + executeTool (search_web/navigate/read_page/read_tab/list_tabs/find_posts/
                      search_history/create_mission/watch_topic/read_form/fill_form/submit_form/save_pdf) + CDP form engine
    cdp.ts            Chrome DevTools Protocol wrapper (attach, evaluate, insertText, clear/select, clicks, keyboard submit)
    scrape.ts         page snapshot, reader extract, framework/color/font facts
    analyze.ts        on-device detection + gpt-4o narrative
    prompt.ts         framework build-prompt generation
    compose.ts        Content Studio (X thread/LinkedIn/IG/YouTube/blog/newsletter/SEO brief) + brand voice
    extract.ts        NL -> structured table -> CSV, auto-pagination
    recall.ts         Total Recall: embed visited pages, cosine search
    xray.ts           in-page fact-check (claims -> verify -> colored <mark> highlights)
src/renderer/src/
  App.tsx, components/ (TitleBar, AddressBar, Sidebar + panels: Chat/Analyze/Prompts/Compose/Extract/Library, MissionsBlock, WebArea, CommandPalette, Icons)
  store/ (browser, chat, analyze, prompt, compose, extract, xray, reader) — Zustand
  lib/markdown.tsx    tiny dependency-free markdown renderer (clickable links open tabs)
```

---

## 3. Features built (all working)
**Sidebar modes:** Chat · Analyze · Prompts · Compose · Extract · Library.

- **Chat (agentic):** streams answers grounded in the live page (scraped text + on-device detection facts). Has TOOLS — it can search the web, navigate, read pages/tabs, make PDFs, extract data, comment on social, search your history, create missions. Markdown rendered, per-message cost caption.
- **Analyze:** free on-device framework/library/font/palette/structure detection + `gpt-4o` "designer's read." Includes **X-ray** fact-check (claims highlighted green/amber/red in the live page).
- **Prompts:** page -> copy-ready build prompt (React/Tailwind, Next.js, Flutter, SwiftUI, HTML).
- **Compose (Content Studio):** page -> X thread / LinkedIn / IG caption / YouTube script / blog outline / newsletter / SEO brief, in a saved **brand voice**.
- **Extract:** NL target -> live table -> CSV (Downloads). Auto-paginates N pages, saves per-domain **playbooks**.
- **Library:** every PDF/extract/compose artifact, searchable, re-openable, + **cost dashboard** (spend today/week/all-time by feature).
- **Total Recall:** every page you read is embedded locally; ask "where did I read about X?" -> answers from your history with links. ~$0.
- **Missions:** standing goals ("keep looking for 2BHK under 25k") re-researched on a schedule in a hidden window; unread badges in chat.
- **Scheduled watches:** topic chips that check Google News every 30 min, badge when new.
- **Research + PDF agent:** "research X and make a PDF" -> multi-search -> deep-verify pass -> styled PDF in Downloads.
- **Ad/tracker blocker** (shield toggle + per-tab count), **cookie-banner auto-dismiss**, **reader mode**, **YouTube ad-skip** (scriptlet: mute+16x+skip on ad-showing).
- **Command palette (Ctrl+K)**, zoom (Ctrl +/-/0), Ctrl+L omnibox, Ctrl+Tab cycle.
- **nori://home** editorial start page.
- **OAuth login works:** UA spoofed to clean Chrome (Google blocks "Electron"), auth popups open as real windows with opener intact.

---

## 4. THE COMMENT ENGINE (the long saga — most important section)
Autonomous, intelligent, human-approved social commenting across platforms. **It works** — posts real, clean, contextual, verified comments on X (confirmed live), and generalizes to Reddit/LinkedIn/blogs. This took ~20 debugging rounds; here's the final architecture so you don't re-break it.

### Why it was hard
Modern SPAs (X/Reddit/YouTube) actively fight automation: shadow-DOM editors, 0px collapsed composers, lazy rendering, Draft.js/Lexical async reconciliation, rate-limiting, and buttons that ignore synthetic clicks.

### The final design (in `agent.ts` + `cdp.ts`)
- **CDP, not coordinate simulation.** Uses `webContents.debugger` (Chrome DevTools Protocol) — the Playwright approach. `Input.insertText` types into the focused element (emoji-safe, no coordinates). This replaced a fragile `sendInputEvent`-at-a-guessed-pixel approach that failed for ~10 rounds (search box, shadow DOM, 0px, off-screen -3576, emoji).
- **Fill (`fill_form` richtext branch):** atomic, focus-preserving. `clickMarked` (real CDP click to focus/expand facade composers) -> `focusMarked` (JS focus belt) -> `selectAll` -> `insertText` (replaces selection) -> `pollUntil` readback **EQUALS** the intended text. Never stacks/interleaves. Verified by equality, not "non-empty."
- **Submit (`submit_form`):** 3 strategies, each verified by "composer actually cleared":
  A. **`submitViaKeyboard`** = Ctrl/Cmd+Enter into the re-focused editor (PRIMARY — this is what actually posts on X). Must re-mark+focus the EDITOR first (SUBMIT_FIND_EXPR marks the BUTTON).
  B. `clickMarkedFull` = full pointer sequence (buttons bitmask + settle + pointerType).
  C. Scripted pointer events + `.click()` + `form.requestSubmit`.
  Success = `clearedAfter()` polls until composer **text empties OR submit button vanishes** (`submitFound:false`). NOTE: earlier bug was polling button-disabled which flips before text clears -> false negatives.
- **Guards (honesty + safety):**
  - Never posts unless the composer holds EXACTLY the intended reply (`expectedText` param + `lastFillByWc` map).
  - Archived/locked posts detected (`pageBlocked`) -> skip.
  - Hard **human approval gate** on every submit (Approve / **Approve all** / Deny). "Approve all" pre-authorizes the rest of a batch (`autoApproveChats`, cleared per message).
  - System prompt has an ABSOLUTE honesty rule: never claim it posted unless the tool returned `ok:true`. And a BIAS-TO-ACTION rule: don't invent "you need to log in" — try first.
- **Discovery (`find_posts`):** scrolls + retries to load lazy posts, extracts **canonical de-duped** post URLs (X `/status/<id>` — strips `/photo`, `/analytics`, `/likes`; Reddit `/comments/`; YouTube `watch?v`). **Excludes already-visited posts** (`visitedByWc`) so batches never loop on the same tweet.
- **Navigation (`navigate`):** verifies it actually LANDED on the intended post (`canonKey`); if X's SPA router kept the old view, hard-reloads with no-cache. Returns `landedAsRequested`.
- **Batch completion (`chat.ts` loop):** parses target N ("10 posts"), counts `submit_form ok:true`, and if the model stops mid-batch it **auto-injects a "continue, posted X of N" nudge** and re-enters (max 8 nudges). `MAX_TOOL_ROUNDS = 90`.
- **Pacing:** ~6s pause after each successful post (anti-spam, keeps X from hiding the composer).
- **read_form:** retries up to 6x with waits + a mid scroll (X lazy-renders the reply box).

### Recent additions (keep these)
- **Autopilot / unattended mode:** a toggle in the chat panel writes `autoApproveSubmits` setting; `requestApproval` in `chat.ts` auto-approves when it's `'1'` (for 24×7 runs). Approval `requestApproval` now resolves a status string (e.g. `'approved'`), not a bare boolean — mind the type if you touch it.
- **API resilience (`openai.ts`):** `withRetry()` wraps `embed`/`completeChat` and `streamChat` retries transient failures (429/5xx/network) with backoff — but `streamChat` will NOT retry once text was already streamed to the UI (would duplicate output). Important for long batch/mission runs.

### Debug logging
Every automation step logs `[nori-automate] ...` to the dev output. To diagnose: run in background, then read the task output file and grep `nori-automate`. This is HOW every comment bug was found — always read the real log, never guess.

### Current known-imperfect (honest)
- On X specifically, hitting *exactly* 10/10 every run isn't guaranteed — X throttles/re-renders; it reliably does several clean posts and the visited-exclusion + nudge push it toward N. This is inherent to driving a hostile SPA via an LLM loop (even Playwright farms retry).
- On "trending topics": X's Explore page lists TOPIC names, not posts — the doctrine tells it to pick a topic and search `x.com/search?q=<topic>&f=live` then `find_posts`.

---

## 5. How to debug (the proven workflow)
1. Make change -> `npx tsc --noEmit` both configs -> kill electron, `npm run dev`.
2. User runs the action in the app.
3. Read `[nori-automate]` lines from the background task output file. The log shows exact fill text, readback equality, submit strategy results, clearedAfter, find_posts counts.
4. Diagnose from the log, not intuition. Two multi-agent **Workflow** audits (opus) were used for the hardest bugs (garbled text; submit-not-firing) and both nailed it — consider that for deep reliability bugs.

---

## 6. What's next (suggested, not yet built)
- **Verify a clean 10-post batch** with the anti-churn (visited-exclusion) fix — last change made, not yet confirmed by user.
- **Multi-brand voice profiles** (agency use — switch voices per client).
- **Campaign mode** for Compose (one page -> a week of posts as a reviewable queue).
- **Outreach as a dedicated sidebar panel/queue** (drafts + approve, instead of chat-driven).
- **`/docs` set** — repo has ~45 source files and zero docs; PRD/ARCHITECTURE/DATABASE/API/AI_ENGINE/AUTOMATION/ROADMAP/CONTRIBUTING outlined in the plan file `~/.claude/plans/sorry-continue-binary-flame.md`.
- Full plan history: `C:\Users\DELL\.claude\plans\sorry-continue-binary-flame.md` (v0, v0.2, v0.3, reliability rebuilds).

## 7. Working style the user expects
- Plan first for big things; ask before big scope. No git pull/push without asking.
- Be honest about failures — read the actual log, don't fake success. (This mirrors Nori's own honesty rule.)
- Fabulous UI matters. Keep the editorial design language.
- The comment engine is DONE — don't re-architect it unless a genuinely new failure mode appears in a log.

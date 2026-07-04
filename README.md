<div align="center">

<img src="build/icon.png" width="120" alt="Nori" />

# Nori

### The AI-native productivity browser

*A real browser with hands. It reads the web with you, remembers everything you read,
runs standing missions, and engages on social — every action under your approval.*

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-34503e)](https://github.com/Afzalkhan001/nori-ai-browser/releases)
[![Electron](https://img.shields.io/badge/Electron-33-2f3241)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-e9e4d6)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Afzalkhan001/nori-ai-browser?color=34503e&label=download)](https://github.com/Afzalkhan001/nori-ai-browser/releases/latest)

</div>

---

## What is Nori?

Nori is a full desktop web browser with an AI sidebar that can actually *do things* on
the pages you visit — not a chat box bolted onto a webview. It reads the live page,
searches the web, extracts data to CSV, writes content in your voice, remembers every
page you read, and can autonomously comment on social posts — always behind a human
approval gate.

The only paid resource is **your own OpenAI API key**. No accounts, no cloud backend,
no telemetry. Everything is stored locally on your machine.

<div align="center">

*Luxury-editorial design — porcelain, ink & moss. No chat bubbles. Slow, deliberate motion.*

</div>

---

## ✨ Features

| | |
|---|---|
| 💬 **Agentic Chat** | Grounded in the live page. Has tools — search the web, navigate, read pages & tabs, make PDFs, extract data, comment on social, search your history, create missions. |
| 🔍 **Analyze** | On-device framework / library / font / palette detection plus a designer's read. Includes **X-ray** fact-checking that highlights claims green / amber / red in the live page. |
| ⌨️ **Prompts** | Turn any page into a copy-ready build prompt (React/Tailwind, Next.js, Flutter, SwiftUI, HTML). |
| ✍️ **Compose** | Any page → X thread, LinkedIn post, IG caption, YouTube script, blog outline, newsletter or SEO brief — in your saved brand voice. |
| 📊 **Extract** | Natural-language target → live table → CSV. Auto-paginates and saves per-domain playbooks. |
| 🧠 **Total Recall** | Every page you read is embedded locally. Ask *"where did I read about X?"* and get answers from your own history, with links. ~$0. |
| 🎯 **Missions** | Standing goals ("keep looking for a 2BHK under 25k") re-researched on a schedule in the background, with unread badges. |
| 🗣️ **Outreach engine** | Finds genuine, high-quality posts (engagement-scored, spam-filtered), drafts a unique on-topic reply for each, and posts — every submission gated by your approval, or hands-off with **Autopilot**. |
| 🛡️ **Clean browsing** | Ad / tracker blocker, cookie-banner auto-dismiss, reader mode, YouTube ad-skip. |
| 📚 **Library** | Every PDF, extract and composition — searchable, re-openable, with a cost dashboard (spend by feature). |

---

## 📥 Download & Install

Grab the latest installer from the **[Releases page](https://github.com/Afzalkhan001/nori-ai-browser/releases/latest)**:

- **Windows** — `Nori-Setup-x.y.z.exe` → run it, pick an install location, done.
- **macOS** — `Nori-x.y.z.dmg` → open, drag Nori to Applications.

> Builds are not code-signed yet, so the OS may show a one-time warning.
> **Windows:** *More info → Run anyway.* **macOS:** right-click → *Open*, then *Open*.

### First run

Paste your **OpenAI API key** when Nori asks — it's stored locally on your device and
only ever used to call OpenAI. Get one at
[platform.openai.com/api-keys](https://platform.openai.com/api-keys).

Nori auto-updates: when a new release is published, it downloads in the background and
installs on next quit.

---

## 🛠️ Build from source

**Requirements:** Node 20+, npm.

```bash
git clone https://github.com/Afzalkhan001/nori-ai-browser.git
cd nori-ai-browser
npm install

# add your key for local dev (optional — you can also paste it in the UI)
echo "OPENAI_API_KEY=sk-..." > .env

npm run dev          # run in development (hot reload)
npm run typecheck    # type-check main + renderer
```

### Package installers

```bash
npm run dist:win     # → release/Nori Setup x.y.z.exe
npm run dist:mac     # → release/Nori-x.y.z.dmg   (must run on macOS)
npm run icon         # regenerate the app icon from scripts/generate-icon.cjs
```

> **Windows note:** if `electron-builder` fails extracting `winCodeSign`
> (*"A required privilege is not held by the client"*), enable **Developer Mode**
> (Settings → Privacy & security → For developers) or run the build from an
> **Administrator** terminal. This is a Windows symlink-permission quirk, unrelated
> to Nori. CI (below) avoids it entirely.

---

## 🚀 Releasing updates

Publishing is automated. Bump the version, tag it, and push — GitHub Actions builds
the Windows **and** macOS installers on their native runners and attaches them to a
new GitHub Release. Installed copies pick up the update automatically.

```bash
npm version patch          # 0.1.0 → 0.1.1 (also creates the git tag)
git push --follow-tags     # → CI builds & publishes the release
```

The workflow lives in [`.github/workflows/release.yml`](.github/workflows/release.yml)
and needs no secrets beyond the default `GITHUB_TOKEN`.

To publish from your own machine instead (Windows exe only, from Windows):

```bash
# one-time: a GitHub token with 'repo' scope
export GH_TOKEN=ghp_...
npm run release
```

---

## 🏗️ Architecture

```
src/
├── main/                    Electron main process (Node)
│   ├── tabs.ts              one WebContentsView per tab, over a floating canvas
│   ├── ipc.ts               typed IPC handlers
│   ├── updater.ts           auto-update via electron-updater + GitHub Releases
│   ├── db/                  crash-safe local JSON store (atomic writes + backup)
│   └── ai-engine/           all AI logic — the future backend seam
│       ├── chat.ts          the agent loop (tools, approval gate, batch guarantee)
│       ├── agent.ts         tool definitions + CDP-driven form/comment engine
│       ├── cdp.ts           Chrome DevTools Protocol wrapper (reliable input)
│       ├── recall.ts        local semantic memory (embeddings + cosine search)
│       └── ...              analyze, compose, extract, prompt, xray
├── preload/                 contextBridge — exposes window.nori.*
├── renderer/                React 18 + TypeScript + Tailwind v4 + Zustand
└── shared/                  the cross-process type contract
```

**Stack:** Electron 33 · React 18 · TypeScript · Tailwind v4 · Zustand · OpenAI
(`gpt-4o` for research, `gpt-4o-mini` for chat, `text-embedding-3-small` for memory).

**Reliability:** atomic JSON persistence with automatic backup recovery, OpenAI
retry/backoff, self-healing crashed tabs, a human-in-the-loop approval gate on every
outbound action, and an honesty rule — Nori never claims it did something unless the
tool actually confirmed it.

---

## 🔒 Privacy

Nori is local-first. Your browsing memory, chats, settings and API key live in a JSON
store in your user-data folder and never leave your machine — except the specific
text sent to OpenAI to fulfil a request you made. There is no analytics, no account,
and no server.

---

## 📄 License

[MIT](LICENSE) © 2026 Afzal Khan

<div align="center">
<sub>Built with care. Fabulous by default.</sub>
</div>

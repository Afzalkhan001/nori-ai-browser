import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { atomicWrite, loadJson } from './fsafe'
import type { Artifact, ChatMessage, CostSummary, Mission, MissionLogEntry, Playbook } from '@shared/types'

/**
 * Local persistence. v0 uses a JSON file in userData behind a narrow,
 * table-shaped API (see docs/DATABASE.md) — swappable for better-sqlite3
 * without touching callers. Chat volume is tiny; this is deliberate.
 */

export interface Watch {
  id: string
  topic: string
  createdAt: number
  seenUrls: string[]
  unread: number
  items: { title: string; url: string }[]
}

interface CostEntry {
  ts: number
  model: string
  inputTokens: number
  outputTokens: number
  usd: number
  source?: string
}

interface StoreShape {
  messages: ChatMessage[]
  costLog: CostEntry[]
  settings: Record<string, string>
  watches: Watch[]
  artifacts: Artifact[]
  playbooks: Playbook[]
  missions: Mission[]
}

let data: StoreShape | null = null
let filePath = ''

function load(): StoreShape {
  if (data) return data
  const dir = join(app.getPath('userData'), 'nori-data')
  mkdirSync(dir, { recursive: true })
  filePath = join(dir, 'store.json')
  const parsed = loadJson<StoreShape>(filePath)
  if (parsed) {
    data = parsed
    data.messages ??= []
    data.costLog ??= []
    data.settings ??= {} // older store files predate these fields
    data.watches ??= []
    data.artifacts ??= []
    data.playbooks ??= []
    data.missions ??= []
    for (const w of data.watches) {
      w.seenUrls ??= []
      w.unread ??= 0
      w.items ??= []
    }
  } else {
    data = {
      messages: [],
      costLog: [],
      settings: {},
      watches: [],
      artifacts: [],
      playbooks: [],
      missions: []
    }
  }
  return data
}

let saveTimer: NodeJS.Timeout | null = null
function save(): void {
  // Debounced write — streaming updates arrive fast.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    atomicWrite(filePath, JSON.stringify(load()))
  }, 250)
}

/** Write any pending debounced state NOW — called on app quit so nothing is lost. */
export function flush(): void {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  atomicWrite(filePath, JSON.stringify(load()))
}

export function addMessage(msg: ChatMessage): void {
  load().messages.push(msg)
  save()
}

export function updateMessage(id: string, patch: Partial<ChatMessage>): void {
  const msg = load().messages.find((m) => m.id === id)
  if (msg) Object.assign(msg, patch)
  save()
}

export function getMessages(chatId: string): ChatMessage[] {
  return load().messages.filter((m) => m.chatId === chatId)
}

export function clearChat(chatId: string): void {
  const s = load()
  s.messages = s.messages.filter((m) => m.chatId !== chatId)
  save()
}

export function logCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  usd: number,
  source = 'chat'
): void {
  load().costLog.push({ ts: Date.now(), model, inputTokens, outputTokens, usd, source })
  save()
}

export function costSummary(): CostSummary {
  const log = load().costLog
  const now = Date.now()
  const dayStart = new Date().setHours(0, 0, 0, 0)
  const weekAgo = now - 7 * 24 * 3600 * 1000
  const by: Record<string, number> = {}
  let today = 0
  let week = 0
  let total = 0
  for (const e of log) {
    total += e.usd
    if (e.ts >= dayStart) today += e.usd
    if (e.ts >= weekAgo) week += e.usd
    const src = e.source ?? 'chat'
    by[src] = (by[src] ?? 0) + e.usd
  }
  return {
    todayUsd: today,
    weekUsd: week,
    totalUsd: total,
    bySource: Object.entries(by)
      .map(([source, usd]) => ({ source, usd }))
      .sort((a, b) => b.usd - a.usd)
  }
}

// ----- Artifacts (research library) -----

export function addArtifact(a: Omit<Artifact, 'id' | 'createdAt'>): Artifact {
  const full: Artifact = { ...a, id: randomUUID(), createdAt: Date.now() }
  const s = load()
  s.artifacts.unshift(full)
  if (s.artifacts.length > 200) s.artifacts.length = 200
  save()
  return full
}

export function listArtifacts(): Artifact[] {
  return load().artifacts
}

export function deleteArtifact(id: string): void {
  const s = load()
  s.artifacts = s.artifacts.filter((a) => a.id !== id)
  save()
}

// ----- Playbooks -----

export function listPlaybooks(): Playbook[] {
  return load().playbooks
}

export function savePlaybook(domain: string, name: string, target: string, columns: string[]): Playbook {
  const p: Playbook = { id: randomUUID(), domain, name, target, columns, createdAt: Date.now() }
  const s = load()
  // one playbook per domain+name; replace
  s.playbooks = s.playbooks.filter((x) => !(x.domain === domain && x.name === name))
  s.playbooks.unshift(p)
  save()
  return p
}

export function deletePlaybook(id: string): void {
  const s = load()
  s.playbooks = s.playbooks.filter((p) => p.id !== id)
  save()
}

// ----- Watch state -----

export function updateWatch(id: string, patch: Partial<Watch>): void {
  const w = load().watches.find((x) => x.id === id)
  if (w) Object.assign(w, patch)
  save()
}

// ----- Missions -----

export function listMissions(): Mission[] {
  return load().missions
}

export function addMission(goal: string, schedule: 'hourly' | 'daily'): Mission {
  const m: Mission = {
    id: randomUUID(),
    goal: goal.trim(),
    schedule,
    createdAt: Date.now(),
    lastRunAt: 0,
    seenUrls: [],
    log: [],
    unread: 0
  }
  const s = load()
  if (!s.missions.some((x) => x.goal.toLowerCase() === m.goal.toLowerCase())) {
    s.missions.push(m)
    save()
  }
  return m
}

export function removeMission(id: string): void {
  const s = load()
  s.missions = s.missions.filter((m) => m.id !== id)
  save()
}

export function updateMission(id: string, patch: Partial<Mission>): void {
  const m = load().missions.find((x) => x.id === id)
  if (m) Object.assign(m, patch)
  save()
}

export function appendMissionLog(id: string, entry: MissionLogEntry, newUrls: string[]): void {
  const m = load().missions.find((x) => x.id === id)
  if (!m) return
  m.log.unshift(entry)
  if (m.log.length > 30) m.log.length = 30
  m.seenUrls = [...new Set([...m.seenUrls, ...newUrls])].slice(-300)
  m.unread = Math.min(m.unread + entry.items.length, 50)
  m.lastRunAt = Date.now()
  save()
}

export function markMissionSeen(id: string): void {
  const m = load().missions.find((x) => x.id === id)
  if (m) m.unread = 0
  save()
}

export function markWatchSeen(id: string): void {
  const w = load().watches.find((x) => x.id === id)
  if (w) {
    w.unread = 0
    w.seenUrls = [...new Set([...w.seenUrls, ...w.items.map((i) => i.url)])].slice(-100)
  }
  save()
}

export function getSetting(key: string): string | null {
  return load().settings[key] ?? null
}

export function setSetting(key: string, value: string): void {
  load().settings[key] = value
  save()
}

export function listWatches(): Watch[] {
  return load().watches
}

export function addWatch(topic: string): Watch {
  const w: Watch = {
    id: String(Date.now()),
    topic: topic.trim(),
    createdAt: Date.now(),
    seenUrls: [],
    unread: 0,
    items: []
  }
  const s = load()
  // no duplicate topics
  if (!s.watches.some((x) => x.topic.toLowerCase() === w.topic.toLowerCase())) {
    s.watches.push(w)
    save()
  }
  return w
}

export function removeWatch(id: string): void {
  const s = load()
  s.watches = s.watches.filter((w) => w.id !== id)
  save()
}

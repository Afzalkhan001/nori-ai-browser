// Shared IPC contract between main, preload and renderer.
// This file is the single source of truth for cross-process types.

export interface TabState {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  blockedCount: number
}

export interface BrowserState {
  tabs: TabState[]
  activeTabId: string | null
}

/** Bounds of the web content area, reported by the renderer via ResizeObserver. */
export interface WebAreaBounds {
  x: number
  y: number
  width: number
  height: number
}

// ---------- AI ----------

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  chatId: string
  role: ChatRole
  content: string
  model: string | null
  costUsd: number | null
  createdAt: number
}

export interface AiStatus {
  hasKey: boolean
}

export interface ChatChunk {
  chatId: string
  messageId: string
  delta: string
}

export interface ChatDone {
  chatId: string
  messageId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Final message text — replaces the streamed accumulation (nudged batch runs
   *  stream intermediate progress notes that are NOT part of the final answer). */
  content: string
}

export interface ChatError {
  chatId: string
  messageId: string
  message: string
}

export interface ChatStepEvt {
  chatId: string
  label: string
}

/** A committing action awaiting the user's explicit go-ahead. */
export interface ApprovalRequestEvt {
  chatId: string
  requestId: string
  summary: string
}

// ---------- Extract / Watches / Library ----------

export interface ExtractTable {
  columns: string[]
  rows: string[][]
}

export interface ExtractProgressEvt {
  tabId: string
  page: number
  total: number
  rowCount: number
}

export interface WatchItem {
  id: string
  topic: string
  createdAt: number
  unread: number
  items: { title: string; url: string }[]
}

export interface MissionLogEntry {
  ts: number
  summary: string
  items: { title: string; url: string }[]
}

export interface Mission {
  id: string
  goal: string
  schedule: 'hourly' | 'daily'
  createdAt: number
  lastRunAt: number
  seenUrls: string[]
  log: MissionLogEntry[]
  unread: number
  running?: boolean
}

export type XrayVerdict = 'supported' | 'disputed' | 'unverified'

export interface XrayClaimEvt {
  tabId: string
  idx: number
  total: number
  claim: string
  verdict: XrayVerdict
  note: string
  sources: string[]
}

export type ArtifactType = 'pdf' | 'extract' | 'compose'

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  createdAt: number
  meta: { path?: string; target?: string; format?: string; rowCount?: number; url?: string }
  data?: { columns?: string[]; rows?: string[][]; text?: string }
}

export interface Playbook {
  id: string
  domain: string
  name: string
  target: string
  columns: string[]
  createdAt: number
}

export interface CostSummary {
  todayUsd: number
  weekUsd: number
  totalUsd: number
  bySource: { source: string; usd: number }[]
}

export interface ReaderData {
  title: string
  url: string
  byline: string
  text: string
}

// ---------- Analyze ----------

export interface PageFacts {
  url: string
  title: string
  framework: string[]
  libraries: string[]
  fonts: string[]
  colors: { hex: string; count: number }[]
  counts: { links: number; buttons: number; forms: number; images: number; headings: number }
  generator: string
}

export interface AnalyzeChunkEvt {
  tabId: string
  delta: string
}

export interface AnalyzeDoneEvt {
  tabId: string
  costUsd: number
}

export interface AnalyzeErrorEvt {
  tabId: string
  message: string
}

export const IPC = {
  // renderer -> main (invoke)
  TabCreate: 'tabs:create',
  TabClose: 'tabs:close',
  TabActivate: 'tabs:activate',
  TabNavigate: 'tabs:navigate',
  TabGoBack: 'tabs:goBack',
  TabGoForward: 'tabs:goForward',
  TabReload: 'tabs:reload',
  TabStop: 'tabs:stop',
  LayoutSetWebArea: 'layout:setWebArea',
  WindowMinimize: 'window:minimize',
  WindowMaximizeToggle: 'window:maximizeToggle',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:isMaximized',
  AiGetStatus: 'ai:getStatus',
  AiSetKey: 'ai:setKey',
  ChatSend: 'chat:send',
  ChatGetMessages: 'chat:getMessages',
  ChatClear: 'chat:clear',
  AnalyzeFacts: 'analyze:facts',
  AnalyzeSynthesize: 'analyze:synthesize',
  PromptGenerate: 'prompt:generate',
  ComposeGenerate: 'compose:generate',
  ExtractRun: 'extract:run',
  ExtractRunAuto: 'extract:runAuto',
  ExtractExport: 'extract:export',
  WatchList: 'watch:list',
  WatchRemove: 'watch:remove',
  WatchMarkSeen: 'watch:markSeen',
  LibraryList: 'library:list',
  LibraryDelete: 'library:delete',
  LibraryOpenPath: 'library:openPath',
  PlaybookList: 'playbook:list',
  PlaybookSave: 'playbook:save',
  PlaybookDelete: 'playbook:delete',
  CostSummary: 'cost:summary',
  MissionList: 'mission:list',
  MissionCreate: 'mission:create',
  MissionRemove: 'mission:remove',
  MissionMarkSeen: 'mission:markSeen',
  MissionRunNow: 'mission:runNow',
  RecallToggle: 'recall:toggle',
  RecallStatus: 'recall:status',
  XrayRun: 'xray:run',
  ReaderGet: 'reader:get',
  ReaderSetHidden: 'reader:setHidden',
  TabZoom: 'tabs:zoom',
  ApprovalRespond: 'chat:approvalRespond',
  BlockerGet: 'blocker:get',
  BlockerToggle: 'blocker:toggle',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  // main -> renderer (send)
  BrowserStateChanged: 'browser:stateChanged',
  WindowMaximizedChanged: 'window:maximizedChanged',
  ChatChunk: 'chat:chunk',
  ChatDone: 'chat:done',
  ChatError: 'chat:error',
  ChatStep: 'chat:step',
  AnalyzeChunk: 'analyze:chunk',
  AnalyzeDone: 'analyze:done',
  AnalyzeError: 'analyze:error',
  PromptChunk: 'prompt:chunk',
  PromptDone: 'prompt:done',
  PromptError: 'prompt:error',
  ComposeChunk: 'compose:chunk',
  ComposeDone: 'compose:done',
  ComposeError: 'compose:error',
  ExtractProgress: 'extract:progress',
  WatchUpdated: 'watch:updated',
  ApprovalRequest: 'chat:approvalRequest',
  MissionUpdated: 'mission:updated',
  XrayClaim: 'xray:claim',
  XrayDone: 'xray:done',
  XrayError: 'xray:error'
} as const

/** API exposed on window.nori by the preload script. */
export interface NoriApi {
  ai: {
    getStatus: () => Promise<AiStatus>
    setKey: (key: string) => Promise<AiStatus>
    sendMessage: (chatId: string, text: string) => Promise<{ chatId: string; messageId: string }>
    getMessages: (chatId: string) => Promise<ChatMessage[]>
    clearChat: (chatId: string) => Promise<void>
    onChunk: (cb: (c: ChatChunk) => void) => () => void
    onDone: (cb: (d: ChatDone) => void) => () => void
    onError: (cb: (e: ChatError) => void) => () => void
    onStep: (cb: (s: ChatStepEvt) => void) => () => void
    onApprovalRequest: (cb: (r: ApprovalRequestEvt) => void) => () => void
    respondApproval: (requestId: string, approved: boolean, all?: boolean) => Promise<void>
  }
  analyze: {
    getFacts: (tabId: string) => Promise<PageFacts | null>
    synthesize: (tabId: string) => Promise<void>
    onChunk: (cb: (c: AnalyzeChunkEvt) => void) => () => void
    onDone: (cb: (d: AnalyzeDoneEvt) => void) => () => void
    onError: (cb: (e: AnalyzeErrorEvt) => void) => () => void
  }
  prompt: {
    generate: (tabId: string, target: string) => Promise<void>
    onChunk: (cb: (c: AnalyzeChunkEvt) => void) => () => void
    onDone: (cb: (d: AnalyzeDoneEvt) => void) => () => void
    onError: (cb: (e: AnalyzeErrorEvt) => void) => () => void
  }
  compose: {
    generate: (tabId: string, format: string, instructions: string) => Promise<void>
    onChunk: (cb: (c: AnalyzeChunkEvt) => void) => () => void
    onDone: (cb: (d: AnalyzeDoneEvt) => void) => () => void
    onError: (cb: (e: AnalyzeErrorEvt) => void) => () => void
  }
  settings: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
  }
  extract: {
    run: (tabId: string, target: string, priorColumns?: string[]) => Promise<ExtractTable>
    runAuto: (tabId: string, target: string, maxPages: number) => Promise<ExtractTable>
    export: (columns: string[], rows: string[][], name: string) => Promise<string>
    onProgress: (cb: (p: ExtractProgressEvt) => void) => () => void
  }
  watches: {
    list: () => Promise<WatchItem[]>
    remove: (id: string) => Promise<void>
    markSeen: (id: string) => Promise<void>
    onUpdated: (cb: () => void) => () => void
  }
  library: {
    list: () => Promise<Artifact[]>
    delete: (id: string) => Promise<void>
    openPath: (path: string) => Promise<void>
    costSummary: () => Promise<CostSummary>
  }
  playbooks: {
    list: () => Promise<Playbook[]>
    save: (domain: string, name: string, target: string, columns: string[]) => Promise<Playbook>
    delete: (id: string) => Promise<void>
  }
  reader: {
    get: () => Promise<ReaderData | null>
    setHidden: (hidden: boolean) => Promise<void>
  }
  missions: {
    list: () => Promise<Mission[]>
    create: (goal: string, schedule: 'hourly' | 'daily') => Promise<Mission>
    remove: (id: string) => Promise<void>
    markSeen: (id: string) => Promise<void>
    runNow: (id: string) => Promise<void>
    onUpdated: (cb: () => void) => () => void
  }
  recall: {
    status: () => Promise<{ enabled: boolean; pages: number }>
    toggle: () => Promise<boolean>
  }
  xray: {
    run: (tabId: string) => Promise<void>
    onClaim: (cb: (c: XrayClaimEvt) => void) => () => void
    onDone: (cb: (d: AnalyzeDoneEvt) => void) => () => void
    onError: (cb: (e: AnalyzeErrorEvt) => void) => () => void
  }
  blocker: {
    get: () => Promise<boolean>
    toggle: () => Promise<boolean>
  }
  tabs: {
    create: (url?: string) => Promise<string>
    close: (tabId: string) => Promise<void>
    activate: (tabId: string) => Promise<void>
    navigate: (tabId: string, input: string) => Promise<void>
    goBack: (tabId: string) => Promise<void>
    goForward: (tabId: string) => Promise<void>
    reload: (tabId: string) => Promise<void>
    stop: (tabId: string) => Promise<void>
    onStateChanged: (cb: (state: BrowserState) => void) => () => void
  }
  layout: {
    setWebArea: (bounds: WebAreaBounds) => void
  }
  zoom: (action: 'in' | 'out' | 'reset') => Promise<void>
  win: {
    minimize: () => void
    maximizeToggle: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void
  }
}

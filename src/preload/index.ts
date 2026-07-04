import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Agent,
  type AgentSchedule,
  type AgentStepEvt,
  type AnalyzeChunkEvt,
  type ApprovalRequestEvt,
  type AnalyzeDoneEvt,
  type AnalyzeErrorEvt,
  type BrowserState,
  type ChatChunk,
  type ChatDone,
  type ChatError,
  type ChatStepEvt,
  type ExtractProgressEvt,
  type XrayClaimEvt,
  type NoriApi,
  type WebAreaBounds
} from '@shared/types'

function on<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

const api: NoriApi = {
  ai: {
    getStatus: () => ipcRenderer.invoke(IPC.AiGetStatus),
    setKey: (key: string) => ipcRenderer.invoke(IPC.AiSetKey, key),
    sendMessage: (chatId: string, text: string) =>
      ipcRenderer.invoke(IPC.ChatSend, chatId, text),
    getMessages: (chatId: string) => ipcRenderer.invoke(IPC.ChatGetMessages, chatId),
    clearChat: (chatId: string) => ipcRenderer.invoke(IPC.ChatClear, chatId),
    onChunk: on<ChatChunk>(IPC.ChatChunk),
    onDone: on<ChatDone>(IPC.ChatDone),
    onError: on<ChatError>(IPC.ChatError),
    onStep: on<ChatStepEvt>(IPC.ChatStep),
    onApprovalRequest: on<ApprovalRequestEvt>(IPC.ApprovalRequest),
    respondApproval: (requestId: string, approved: boolean, all?: boolean) =>
      ipcRenderer.invoke(IPC.ApprovalRespond, requestId, approved, all)
  },
  analyze: {
    getFacts: (tabId: string) => ipcRenderer.invoke(IPC.AnalyzeFacts, tabId),
    synthesize: (tabId: string) => ipcRenderer.invoke(IPC.AnalyzeSynthesize, tabId),
    onChunk: on<AnalyzeChunkEvt>(IPC.AnalyzeChunk),
    onDone: on<AnalyzeDoneEvt>(IPC.AnalyzeDone),
    onError: on<AnalyzeErrorEvt>(IPC.AnalyzeError)
  },
  prompt: {
    generate: (tabId: string, target: string) =>
      ipcRenderer.invoke(IPC.PromptGenerate, tabId, target),
    onChunk: on<AnalyzeChunkEvt>(IPC.PromptChunk),
    onDone: on<AnalyzeDoneEvt>(IPC.PromptDone),
    onError: on<AnalyzeErrorEvt>(IPC.PromptError)
  },
  compose: {
    generate: (tabId: string, format: string, instructions: string) =>
      ipcRenderer.invoke(IPC.ComposeGenerate, tabId, format, instructions),
    onChunk: on<AnalyzeChunkEvt>(IPC.ComposeChunk),
    onDone: on<AnalyzeDoneEvt>(IPC.ComposeDone),
    onError: on<AnalyzeErrorEvt>(IPC.ComposeError)
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC.SettingsGet, key),
    set: (key: string, value: string) => ipcRenderer.invoke(IPC.SettingsSet, key, value)
  },
  extract: {
    run: (tabId: string, target: string, priorColumns?: string[]) =>
      ipcRenderer.invoke(IPC.ExtractRun, tabId, target, priorColumns),
    runAuto: (tabId: string, target: string, maxPages: number) =>
      ipcRenderer.invoke(IPC.ExtractRunAuto, tabId, target, maxPages),
    export: (columns: string[], rows: string[][], name: string) =>
      ipcRenderer.invoke(IPC.ExtractExport, columns, rows, name),
    onProgress: on<ExtractProgressEvt>(IPC.ExtractProgress)
  },
  watches: {
    list: () => ipcRenderer.invoke(IPC.WatchList),
    remove: (id: string) => ipcRenderer.invoke(IPC.WatchRemove, id),
    markSeen: (id: string) => ipcRenderer.invoke(IPC.WatchMarkSeen, id),
    onUpdated: on<void>(IPC.WatchUpdated)
  },
  library: {
    list: () => ipcRenderer.invoke(IPC.LibraryList),
    delete: (id: string) => ipcRenderer.invoke(IPC.LibraryDelete, id),
    openPath: (path: string) => ipcRenderer.invoke(IPC.LibraryOpenPath, path),
    costSummary: () => ipcRenderer.invoke(IPC.CostSummary)
  },
  playbooks: {
    list: () => ipcRenderer.invoke(IPC.PlaybookList),
    save: (domain: string, name: string, target: string, columns: string[]) =>
      ipcRenderer.invoke(IPC.PlaybookSave, domain, name, target, columns),
    delete: (id: string) => ipcRenderer.invoke(IPC.PlaybookDelete, id)
  },
  reader: {
    get: () => ipcRenderer.invoke(IPC.ReaderGet),
    setHidden: (hidden: boolean) => ipcRenderer.invoke(IPC.ReaderSetHidden, hidden)
  },
  missions: {
    list: () => ipcRenderer.invoke(IPC.MissionList),
    create: (goal: string, schedule: 'hourly' | 'daily') =>
      ipcRenderer.invoke(IPC.MissionCreate, goal, schedule),
    remove: (id: string) => ipcRenderer.invoke(IPC.MissionRemove, id),
    markSeen: (id: string) => ipcRenderer.invoke(IPC.MissionMarkSeen, id),
    runNow: (id: string) => ipcRenderer.invoke(IPC.MissionRunNow, id),
    onUpdated: on<void>(IPC.MissionUpdated)
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC.AgentList),
    create: (name: string, goal: string, schedule: AgentSchedule, autopilot: boolean) =>
      ipcRenderer.invoke(IPC.AgentCreate, name, goal, schedule, autopilot),
    update: (id: string, patch: Partial<Agent>) => ipcRenderer.invoke(IPC.AgentUpdate, id, patch),
    remove: (id: string) => ipcRenderer.invoke(IPC.AgentRemove, id),
    runNow: (id: string) => ipcRenderer.invoke(IPC.AgentRunNow, id),
    stopRun: (id: string) => ipcRenderer.invoke(IPC.AgentStopRun, id),
    markSeen: (id: string) => ipcRenderer.invoke(IPC.AgentMarkSeen, id),
    dismissPending: (agentId: string, pendingId: string) =>
      ipcRenderer.invoke(IPC.AgentDismissPending, agentId, pendingId),
    onUpdated: on<void>(IPC.AgentUpdated),
    onStep: on<AgentStepEvt>(IPC.AgentStep)
  },
  recall: {
    status: () => ipcRenderer.invoke(IPC.RecallStatus),
    toggle: () => ipcRenderer.invoke(IPC.RecallToggle)
  },
  xray: {
    run: (tabId: string) => ipcRenderer.invoke(IPC.XrayRun, tabId),
    onClaim: on<XrayClaimEvt>(IPC.XrayClaim),
    onDone: on<AnalyzeDoneEvt>(IPC.XrayDone),
    onError: on<AnalyzeErrorEvt>(IPC.XrayError)
  },
  blocker: {
    get: () => ipcRenderer.invoke(IPC.BlockerGet),
    toggle: () => ipcRenderer.invoke(IPC.BlockerToggle)
  },
  tabs: {
    create: (url?: string) => ipcRenderer.invoke(IPC.TabCreate, url),
    close: (tabId: string) => ipcRenderer.invoke(IPC.TabClose, tabId),
    activate: (tabId: string) => ipcRenderer.invoke(IPC.TabActivate, tabId),
    navigate: (tabId: string, input: string) => ipcRenderer.invoke(IPC.TabNavigate, tabId, input),
    goBack: (tabId: string) => ipcRenderer.invoke(IPC.TabGoBack, tabId),
    goForward: (tabId: string) => ipcRenderer.invoke(IPC.TabGoForward, tabId),
    reload: (tabId: string) => ipcRenderer.invoke(IPC.TabReload, tabId),
    stop: (tabId: string) => ipcRenderer.invoke(IPC.TabStop, tabId),
    onStateChanged: (cb: (state: BrowserState) => void) => {
      const listener = (_e: unknown, state: BrowserState) => cb(state)
      ipcRenderer.on(IPC.BrowserStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.BrowserStateChanged, listener)
    }
  },
  layout: {
    setWebArea: (bounds: WebAreaBounds) => ipcRenderer.send(IPC.LayoutSetWebArea, bounds)
  },
  zoom: (action: 'in' | 'out' | 'reset') => ipcRenderer.invoke(IPC.TabZoom, action),
  win: {
    minimize: () => ipcRenderer.send(IPC.WindowMinimize),
    maximizeToggle: () => ipcRenderer.send(IPC.WindowMaximizeToggle),
    close: () => ipcRenderer.send(IPC.WindowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.WindowIsMaximized),
    onMaximizedChanged: (cb: (maximized: boolean) => void) => {
      const listener = (_e: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on(IPC.WindowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.WindowMaximizedChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('nori', api)

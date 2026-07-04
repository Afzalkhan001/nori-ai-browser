import { BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, type WebAreaBounds } from '@shared/types'
import type { TabManager } from './tabs'
import { hasKey, setApiKey } from './ai-engine/openai'
import { resolveApproval, sendMessage } from './ai-engine/chat'
import { readerExtract, scrapePage, snapshotToContext } from './ai-engine/scrape'
import { getFacts, synthesize } from './ai-engine/analyze'
import { generatePrompt } from './ai-engine/prompt'
import { compose } from './ai-engine/compose'
import { exportCsv, runExtract, runExtractAuto } from './ai-engine/extract'
import * as blocker from './blocker'
import * as recall from './ai-engine/recall'
import { runMission } from './missions'
import { runAgent, runSkill, stopAgentRun } from './ai-engine/agent-run'
import type { Agent, AgentSchedule, Skill, SkillParam } from '@shared/types'
import { runXray } from './ai-engine/xray'
import * as store from './db/store'

export function registerIpc(win: BrowserWindow, tabs: TabManager): void {
  // ----- AI -----
  ipcMain.handle(IPC.AiGetStatus, () => ({ hasKey: hasKey() }))
  ipcMain.handle(IPC.AiSetKey, (_e, key: string) => {
    const k = String(key ?? '').trim()
    store.setSetting('openaiApiKey', k) // persisted (userData); survives restarts
    setApiKey(k)
    return { hasKey: hasKey() }
  })
  ipcMain.handle(IPC.ChatSend, async (_e, chatId: string, text: string) => {
    // chatId == tabId: ground the chat in that tab's live page.
    const wc = tabs.getWebContents(chatId)
    const [snap, facts] = wc
      ? await Promise.all([scrapePage(wc), getFacts(wc)])
      : [null, null]
    const parts: string[] = []
    if (facts) {
      // On-device detection facts — lets Chat answer stack/design questions directly.
      parts.push(
        `Detected tech & design facts (from on-device inspection, trustworthy):\n` +
          JSON.stringify(
            { framework: facts.framework, libraries: facts.libraries, fonts: facts.fonts, colors: facts.colors.map((c) => c.hex), generator: facts.generator },
            null,
            1
          )
      )
    }
    if (snap) parts.push(snapshotToContext(snap))
    return sendMessage(win, chatId, text, parts.length ? parts.join('\n\n') : undefined, {
      getWc: () => tabs.getActiveWebContents(),
      tabs
    })
  })
  ipcMain.handle(IPC.ExtractRun, (_e, tabId: string, target: string, priorColumns?: string[]) => {
    const wc = tabs.getWebContents(tabId)
    if (!wc) throw new Error('No active tab.')
    return runExtract(wc, target, priorColumns)
  })
  ipcMain.handle(IPC.ExtractExport, (_e, columns: string[], rows: string[][], name: string) => {
    const path = exportCsv(columns, rows, name)
    store.addArtifact({
      type: 'extract',
      title: name.slice(0, 80),
      meta: { path, target: name, rowCount: rows.length },
      data: { columns, rows }
    })
    return path
  })
  ipcMain.handle(IPC.ExtractRunAuto, (_e, tabId: string, target: string, maxPages: number) => {
    const wc = tabs.getWebContents(tabId)
    if (!wc) throw new Error('No active tab.')
    return runExtractAuto(wc, target, Math.min(Math.max(1, maxPages), 10), (page, total, rowCount) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ExtractProgress, { tabId, page, total, rowCount })
      }
    })
  })
  ipcMain.handle(IPC.WatchList, () => store.listWatches())
  ipcMain.handle(IPC.WatchRemove, (_e, id: string) => store.removeWatch(id))
  ipcMain.handle(IPC.WatchMarkSeen, (_e, id: string) => store.markWatchSeen(id))
  ipcMain.handle(IPC.LibraryList, () => store.listArtifacts())
  ipcMain.handle(IPC.LibraryDelete, (_e, id: string) => store.deleteArtifact(id))
  ipcMain.handle(IPC.LibraryOpenPath, (_e, path: string) => {
    shell.openPath(path)
  })
  ipcMain.handle(IPC.PlaybookList, () => store.listPlaybooks())
  ipcMain.handle(IPC.PlaybookSave, (_e, domain: string, name: string, target: string, columns: string[]) =>
    store.savePlaybook(domain, name, target, columns)
  )
  ipcMain.handle(IPC.PlaybookDelete, (_e, id: string) => store.deletePlaybook(id))
  ipcMain.handle(IPC.CostSummary, () => store.costSummary())
  ipcMain.handle(IPC.ReaderGet, () => {
    const wc = tabs.getActiveWebContents()
    return wc ? readerExtract(wc) : null
  })
  ipcMain.handle(IPC.ReaderSetHidden, (_e, hidden: boolean) => tabs.setReaderHidden(hidden))
  ipcMain.handle(IPC.ApprovalRespond, (_e, requestId: string, approved: boolean, all?: boolean) =>
    resolveApproval(requestId, approved, all)
  )
  ipcMain.handle(IPC.TabZoom, (_e, action: 'in' | 'out' | 'reset') => {
    const wc = tabs.getActiveWebContents()
    if (!wc) return
    if (action === 'reset') wc.setZoomLevel(0)
    else wc.setZoomLevel(wc.getZoomLevel() + (action === 'in' ? 0.5 : -0.5))
  })
  ipcMain.handle(IPC.MissionList, () => store.listMissions())
  ipcMain.handle(IPC.MissionCreate, (_e, goal: string, schedule: 'hourly' | 'daily') =>
    store.addMission(goal, schedule)
  )
  ipcMain.handle(IPC.MissionRemove, (_e, id: string) => store.removeMission(id))
  ipcMain.handle(IPC.MissionMarkSeen, (_e, id: string) => store.markMissionSeen(id))
  ipcMain.handle(IPC.MissionRunNow, async (_e, id: string) => {
    await runMission(id)
    if (!win.isDestroyed()) win.webContents.send(IPC.MissionUpdated)
  })
  // ----- Agents (autonomous, acting) -----
  ipcMain.handle(IPC.AgentList, () => store.listAgents())
  ipcMain.handle(
    IPC.AgentCreate,
    (_e, name: string, goal: string, schedule: AgentSchedule, autopilot: boolean) =>
      store.addAgent(name, goal, schedule, autopilot)
  )
  ipcMain.handle(IPC.AgentUpdate, (_e, id: string, patch: Partial<Agent>) => {
    store.updateAgent(id, patch)
    if (!win.isDestroyed()) win.webContents.send(IPC.AgentUpdated)
  })
  ipcMain.handle(IPC.AgentRemove, (_e, id: string) => {
    store.removeAgent(id)
    if (!win.isDestroyed()) win.webContents.send(IPC.AgentUpdated)
  })
  ipcMain.handle(IPC.AgentRunNow, (_e, id: string) => {
    void runAgent(id) // fire-and-forget; UI updates via AgentUpdated/AgentStep events
  })
  ipcMain.handle(IPC.AgentStopRun, (_e, id: string) => stopAgentRun(id))
  ipcMain.handle(IPC.AgentMarkSeen, (_e, id: string) => store.markAgentSeen(id))
  ipcMain.handle(IPC.AgentDismissPending, (_e, agentId: string, pendingId: string) => {
    store.dismissAgentPending(agentId, pendingId)
    if (!win.isDestroyed()) win.webContents.send(IPC.AgentUpdated)
  })
  // ----- Skills (teachable automations) -----
  ipcMain.handle(IPC.SkillList, () => store.listSkills())
  ipcMain.handle(
    IPC.SkillCreate,
    (_e, name: string, description: string, procedure: string, params: SkillParam[], autopilot: boolean) =>
      store.addSkill(name, description, procedure, params, autopilot)
  )
  ipcMain.handle(IPC.SkillUpdate, (_e, id: string, patch: Partial<Skill>) => {
    store.updateSkill(id, patch)
    if (!win.isDestroyed()) win.webContents.send(IPC.SkillUpdated)
  })
  ipcMain.handle(IPC.SkillRemove, (_e, id: string) => {
    store.removeSkill(id)
    if (!win.isDestroyed()) win.webContents.send(IPC.SkillUpdated)
  })
  ipcMain.handle(IPC.SkillRun, (_e, id: string, params: Record<string, string>) => runSkill(id, params))
  ipcMain.handle(IPC.RecallStatus, () => ({ enabled: recall.isEnabled(), pages: recall.recallCount() }))
  ipcMain.handle(IPC.RecallToggle, () => recall.toggle())
  ipcMain.handle(IPC.XrayRun, (_e, tabId: string) => {
    const wc = tabs.getWebContents(tabId)
    if (wc) runXray(win, tabId, wc)
  })
  ipcMain.handle(IPC.BlockerGet, () => blocker.isEnabled())
  ipcMain.handle(IPC.BlockerToggle, () => {
    const on = blocker.toggle()
    tabs.emitState()
    return on
  })
  ipcMain.handle(IPC.ChatGetMessages, (_e, chatId: string) => store.getMessages(chatId))
  ipcMain.handle(IPC.ChatClear, (_e, chatId: string) => store.clearChat(chatId))
  ipcMain.handle(IPC.AnalyzeFacts, (_e, tabId: string) => {
    const wc = tabs.getWebContents(tabId)
    return wc ? getFacts(wc) : null
  })
  ipcMain.handle(IPC.AnalyzeSynthesize, (_e, tabId: string) => {
    const wc = tabs.getWebContents(tabId)
    if (wc) synthesize(win, tabId, wc)
  })
  ipcMain.handle(IPC.PromptGenerate, (_e, tabId: string, target: string) => {
    const wc = tabs.getWebContents(tabId)
    if (wc) generatePrompt(win, tabId, wc, target)
  })
  ipcMain.handle(IPC.ComposeGenerate, (_e, tabId: string, format: string, instructions: string) => {
    const wc = tabs.getWebContents(tabId)
    if (wc) compose(win, tabId, wc, format, instructions)
  })
  ipcMain.handle(IPC.SettingsGet, (_e, key: string) => store.getSetting(key))
  ipcMain.handle(IPC.SettingsSet, (_e, key: string, value: string) => store.setSetting(key, value))

  ipcMain.handle(IPC.TabCreate, (_e, url?: string) => tabs.createTab(url))
  ipcMain.handle(IPC.TabClose, (_e, id: string) => tabs.closeTab(id))
  ipcMain.handle(IPC.TabActivate, (_e, id: string) => tabs.activateTab(id))
  ipcMain.handle(IPC.TabNavigate, (_e, id: string, input: string) => tabs.navigate(id, input))
  ipcMain.handle(IPC.TabGoBack, (_e, id: string) => tabs.goBack(id))
  ipcMain.handle(IPC.TabGoForward, (_e, id: string) => tabs.goForward(id))
  ipcMain.handle(IPC.TabReload, (_e, id: string) => tabs.reload(id))
  ipcMain.handle(IPC.TabStop, (_e, id: string) => tabs.stop(id))

  ipcMain.on(IPC.LayoutSetWebArea, (_e, bounds: WebAreaBounds) => tabs.setWebArea(bounds))

  ipcMain.on(IPC.WindowMinimize, () => win.minimize())
  ipcMain.on(IPC.WindowMaximizeToggle, () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.WindowClose, () => win.close())
  ipcMain.handle(IPC.WindowIsMaximized, () => win.isMaximized())

  win.on('maximize', () => win.webContents.send(IPC.WindowMaximizedChanged, true))
  win.on('unmaximize', () => win.webContents.send(IPC.WindowMaximizedChanged, false))
}

import { create } from 'zustand'
import type { BrowserState, TabState } from '@shared/types'

export type SidebarMode =
  | 'chat'
  | 'agents'
  | 'analyze'
  | 'prompts'
  | 'compose'
  | 'extract'
  | 'library'

interface BrowserStore extends BrowserState {
  sidebarOpen: boolean
  sidebarMode: SidebarMode
  setState: (s: BrowserState) => void
  toggleSidebar: () => void
  setSidebarMode: (m: SidebarMode) => void
  activeTab: () => TabState | null
}

export const useBrowser = create<BrowserStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  sidebarOpen: true,
  sidebarMode: 'chat',
  setState: (s) => set({ tabs: s.tabs, activeTabId: s.activeTabId }),
  toggleSidebar: () => set((st) => ({ sidebarOpen: !st.sidebarOpen })),
  setSidebarMode: (m) => set({ sidebarMode: m, sidebarOpen: true }),
  activeTab: () => {
    const { tabs, activeTabId } = get()
    return tabs.find((t) => t.id === activeTabId) ?? null
  }
}))

// Subscribe once to main-process browser state.
window.nori.tabs.onStateChanged((state) => {
  useBrowser.getState().setState(state)
})

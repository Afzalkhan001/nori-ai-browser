import { create } from 'zustand'
import type { XrayClaimEvt } from '@shared/types'

interface TabXray {
  claims: XrayClaimEvt[]
  running: boolean
  total: number
  error: string | null
  costUsd: number | null
}

interface XrayStore {
  byTab: Record<string, TabXray>
  run: (tabId: string) => Promise<void>
}

const empty: TabXray = { claims: [], running: false, total: 0, error: null, costUsd: null }

export const useXray = create<XrayStore>((set) => ({
  byTab: {},

  run: async (tabId) => {
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...empty, running: true } } }))
    await window.nori.xray.run(tabId)
  }
}))

window.nori.xray.onClaim((c) => {
  useXray.setState((s) => {
    const cur = s.byTab[c.tabId] ?? empty
    return {
      byTab: {
        ...s.byTab,
        [c.tabId]: { ...cur, claims: [...cur.claims, c], total: c.total }
      }
    }
  })
})

window.nori.xray.onDone(({ tabId, costUsd }) => {
  useXray.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false, costUsd } }
  }))
})

window.nori.xray.onError(({ tabId, message }) => {
  useXray.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false, error: message } }
  }))
})

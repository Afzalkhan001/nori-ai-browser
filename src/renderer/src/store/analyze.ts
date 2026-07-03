import { create } from 'zustand'
import type { PageFacts } from '@shared/types'

interface TabAnalysis {
  facts: PageFacts | null
  narrative: string
  running: boolean
  error: string | null
}

interface AnalyzeStore {
  byTab: Record<string, TabAnalysis>
  run: (tabId: string) => Promise<void>
}

const empty: TabAnalysis = { facts: null, narrative: '', running: false, error: null }

export const useAnalyze = create<AnalyzeStore>((set) => ({
  byTab: {},

  run: async (tabId) => {
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: { ...empty, running: true } }
    }))
    const facts = await window.nori.analyze.getFacts(tabId)
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), facts, running: true } }
    }))
    // Narrative streams in via onChunk below.
    await window.nori.analyze.synthesize(tabId)
  }
}))

window.nori.analyze.onChunk(({ tabId, delta }) => {
  useAnalyze.setState((s) => {
    const cur = s.byTab[tabId] ?? empty
    return { byTab: { ...s.byTab, [tabId]: { ...cur, narrative: cur.narrative + delta } } }
  })
})

window.nori.analyze.onDone(({ tabId }) => {
  useAnalyze.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false } }
  }))
})

window.nori.analyze.onError(({ tabId, message }) => {
  useAnalyze.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false, error: message } }
  }))
})

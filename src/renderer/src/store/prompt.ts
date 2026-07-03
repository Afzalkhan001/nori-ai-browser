import { create } from 'zustand'

interface TabPrompt {
  target: string
  text: string
  running: boolean
  error: string | null
}

interface PromptStore {
  byTab: Record<string, TabPrompt>
  generate: (tabId: string, target: string) => Promise<void>
}

const empty: TabPrompt = { target: '', text: '', running: false, error: null }

export const usePrompt = create<PromptStore>((set) => ({
  byTab: {},

  generate: async (tabId, target) => {
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...empty, target, running: true } } }))
    await window.nori.prompt.generate(tabId, target)
  }
}))

window.nori.prompt.onChunk(({ tabId, delta }) => {
  usePrompt.setState((s) => {
    const cur = s.byTab[tabId] ?? empty
    return { byTab: { ...s.byTab, [tabId]: { ...cur, text: cur.text + delta } } }
  })
})

window.nori.prompt.onDone(({ tabId }) => {
  usePrompt.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false } }
  }))
})

window.nori.prompt.onError(({ tabId, message }) => {
  usePrompt.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false, error: message } }
  }))
})

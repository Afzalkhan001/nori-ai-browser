import { create } from 'zustand'

interface TabCompose {
  format: string
  text: string
  running: boolean
  error: string | null
}

interface ComposeStore {
  byTab: Record<string, TabCompose>
  generate: (tabId: string, format: string, instructions: string) => Promise<void>
  reset: (tabId: string) => void
}

const empty: TabCompose = { format: '', text: '', running: false, error: null }

export const useCompose = create<ComposeStore>((set) => ({
  byTab: {},

  generate: async (tabId, format, instructions) => {
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...empty, format, running: true } } }))
    await window.nori.compose.generate(tabId, format, instructions)
  },

  reset: (tabId) =>
    set((s) => {
      const next = { ...s.byTab }
      delete next[tabId]
      return { byTab: next }
    })
}))

window.nori.compose.onChunk(({ tabId, delta }) => {
  useCompose.setState((s) => {
    const cur = s.byTab[tabId] ?? empty
    return { byTab: { ...s.byTab, [tabId]: { ...cur, text: cur.text + delta } } }
  })
})

window.nori.compose.onDone(({ tabId }) => {
  useCompose.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false } }
  }))
})

window.nori.compose.onError(({ tabId, message }) => {
  useCompose.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? empty), running: false, error: message } }
  }))
})

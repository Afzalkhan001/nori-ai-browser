import { create } from 'zustand'

interface TabExtract {
  target: string
  columns: string[]
  rows: string[][]
  running: boolean
  error: string | null
  progress: string | null
}

interface ExtractStore {
  byTab: Record<string, TabExtract>
  run: (tabId: string, target: string, pages?: number) => Promise<void>
  addPage: (tabId: string) => Promise<void>
  loadArtifact: (tabId: string, target: string, columns: string[], rows: string[][]) => void
  reset: (tabId: string) => void
}

const empty: TabExtract = {
  target: '',
  columns: [],
  rows: [],
  running: false,
  error: null,
  progress: null
}

export const useExtract = create<ExtractStore>((set, get) => ({
  byTab: {},

  run: async (tabId, target, pages = 1) => {
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...empty, target, running: true } } }))
    try {
      const table =
        pages > 1
          ? await window.nori.extract.runAuto(tabId, target, pages)
          : await window.nori.extract.run(tabId, target)
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: {
            target,
            columns: table.columns,
            rows: table.rows,
            running: false,
            error: null,
            progress: null
          }
        }
      }))
    } catch (err) {
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...empty,
            target,
            error: err instanceof Error ? err.message : 'Extraction failed.'
          }
        }
      }))
    }
  },

  loadArtifact: (tabId, target, columns, rows) =>
    set((s) => ({
      byTab: { ...s.byTab, [tabId]: { ...empty, target, columns, rows } }
    })),

  /** Extract the (new) current page with the same schema and append deduped rows. */
  addPage: async (tabId) => {
    const cur = get().byTab[tabId]
    if (!cur || cur.running) return
    set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...cur, running: true, error: null } } }))
    try {
      const table = await window.nori.extract.run(tabId, cur.target, cur.columns)
      const seen = new Set(cur.rows.map((r) => JSON.stringify(r)))
      const fresh = table.rows.filter((r) => !seen.has(JSON.stringify(r)))
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: { ...cur, rows: [...cur.rows, ...fresh], running: false }
        }
      }))
    } catch (err) {
      set((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...cur,
            running: false,
            error: err instanceof Error ? err.message : 'Extraction failed.'
          }
        }
      }))
    }
  },

  reset: (tabId) =>
    set((s) => {
      const next = { ...s.byTab }
      delete next[tabId]
      return { byTab: next }
    })
}))

window.nori.extract.onProgress(({ tabId, page, total, rowCount }) => {
  useExtract.setState((s) => {
    const cur = s.byTab[tabId]
    if (!cur) return s
    return {
      byTab: {
        ...s.byTab,
        [tabId]: { ...cur, progress: `Page ${page} of ${total} — ${rowCount} rows so far` }
      }
    }
  })
})

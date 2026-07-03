import { create } from 'zustand'
import type { ReaderData } from '@shared/types'

interface ReaderStore {
  open: boolean
  data: ReaderData | null
  loading: boolean
  toggle: () => Promise<void>
  close: () => Promise<void>
}

export const useReader = create<ReaderStore>((set, get) => ({
  open: false,
  data: null,
  loading: false,

  toggle: async () => {
    if (get().open) {
      await get().close()
      return
    }
    set({ loading: true })
    const data = await window.nori.reader.get()
    if (!data || data.text.trim().length < 200) {
      set({ loading: false }) // not an article — do nothing
      return
    }
    await window.nori.reader.setHidden(true)
    set({ open: true, data, loading: false })
  },

  close: async () => {
    await window.nori.reader.setHidden(false)
    set({ open: false, data: null })
  }
}))

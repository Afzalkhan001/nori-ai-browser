import type { NoriApi } from '@shared/types'

declare global {
  interface Window {
    nori: NoriApi
  }
}

export {}

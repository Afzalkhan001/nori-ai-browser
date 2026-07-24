import { useEffect } from 'react'
import TitleBar from './components/TitleBar'
import AddressBar from './components/AddressBar'
import Sidebar from './components/Sidebar'
import WebArea from './components/WebArea'
import CommandPalette, { usePalette } from './components/CommandPalette'
import WelcomeModal from './components/WelcomeModal'
import { useBrowser } from './store/browser'

export default function App() {
  const toggleSidebar = useBrowser((s) => s.toggleSidebar)

  // Keyboard shortcuts for the chrome UI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      const k = e.key.toLowerCase()
      const { activeTabId, tabs } = useBrowser.getState()
      if (k === 't') {
        e.preventDefault()
        window.nori.tabs.create()
      } else if (k === 'e') {
        e.preventDefault()
        toggleSidebar()
      } else if (k === 'w') {
        e.preventDefault()
        if (activeTabId) window.nori.tabs.close(activeTabId)
      } else if (k === 'r') {
        e.preventDefault()
        if (activeTabId) window.nori.tabs.reload(activeTabId)
      } else if (k === 'k') {
        e.preventDefault()
        usePalette.getState().setOpen(!usePalette.getState().open)
      } else if (k === 'l') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('nori:focus-omnibox'))
      } else if (e.key === 'Tab') {
        e.preventDefault()
        if (tabs.length > 1 && activeTabId) {
          const idx = tabs.findIndex((t) => t.id === activeTabId)
          const next = tabs[(idx + (e.shiftKey ? -1 + tabs.length : 1)) % tabs.length]
          window.nori.tabs.activate(next.id)
        }
      } else if (k === '=' || k === '+') {
        e.preventDefault()
        window.nori.zoom('in')
      } else if (k === '-') {
        e.preventDefault()
        window.nori.zoom('out')
      } else if (k === '0') {
        e.preventDefault()
        window.nori.zoom('reset')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  return (
    <div className="relative flex h-full flex-col">
      <TitleBar />
      <AddressBar />
      <div className="flex min-h-0 flex-1 gap-2.5 bg-porcelain-100 px-2.5 pb-2.5">
        <WebArea />
        <Sidebar />
      </div>
      <CommandPalette />
      <WelcomeModal />
    </div>
  )
}

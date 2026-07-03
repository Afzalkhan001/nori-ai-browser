import { useBrowser, type SidebarMode } from '../store/browser'
import { IconClose } from './Icons'
import ChatPanel from './ChatPanel'
import AnalyzePanel from './AnalyzePanel'
import PromptPanel from './PromptPanel'
import ComposePanel from './ComposePanel'
import ExtractPanel from './ExtractPanel'
import LibraryPanel from './LibraryPanel'

const MODES: { key: SidebarMode; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'prompts', label: 'Prompts' },
  { key: 'compose', label: 'Compose' },
  { key: 'extract', label: 'Extract' },
  { key: 'library', label: 'Library' }
]

/** Nori Assist shell — mode tabs with a sliding hairline indicator. */
export default function Sidebar() {
  const { sidebarOpen, toggleSidebar, sidebarMode, setSidebarMode } = useBrowser()

  return (
    <div
      className={`flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
        sidebarOpen ? 'w-[404px]' : 'w-0'
      }`}
    >
      {/* Floating card — matches the web canvas frame */}
      <div className="flex h-full w-[404px] flex-col overflow-hidden rounded-[12px] bg-porcelain-50 shadow-[0_2px_18px_rgba(33,33,29,0.08),0_0_0_1px_rgba(33,33,29,0.06)]">
        {/* Header — mode tabs */}
        <div className="hairline flex h-12 shrink-0 items-center justify-between border-b pr-3 pl-5">
          <div className="flex h-full items-stretch gap-3.5">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setSidebarMode(m.key)}
                className={`relative text-[10px] tracking-[0.12em] uppercase transition-colors duration-300 ${
                  sidebarMode === m.key ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'
                }`}
              >
                {m.label}
                <span
                  className={`absolute inset-x-0 -bottom-px h-px bg-moss-600 transition-transform duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
                    sidebarMode === m.key ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
              </button>
            ))}
          </div>
          <button
            onClick={toggleSidebar}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-400 transition-colors hover:text-ink-900"
          >
            <IconClose />
          </button>
        </div>

        {sidebarMode === 'chat' && <ChatPanel />}
        {sidebarMode === 'analyze' && <AnalyzePanel />}
        {sidebarMode === 'prompts' && <PromptPanel />}
        {sidebarMode === 'compose' && <ComposePanel />}
        {sidebarMode === 'extract' && <ExtractPanel />}
        {sidebarMode === 'library' && <LibraryPanel />}
      </div>
    </div>
  )
}

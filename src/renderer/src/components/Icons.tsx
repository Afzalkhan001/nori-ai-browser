// Minimal inline icon set — crisp 16px strokes, no external deps.
interface IconProps {
  className?: string
}

const base = 'w-4 h-4'

export const IconBack = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3 5 8l5 5" />
  </svg>
)

export const IconForward = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 3 5 5-5 5" />
  </svg>
)

export const IconReload = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V6H10" />
  </svg>
)

export const IconClose = ({ className }: IconProps) => (
  <svg className={className ?? 'w-3 h-3'} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const IconPlus = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const IconLock = ({ className }: IconProps) => (
  <svg className={className ?? 'w-3.5 h-3.5'} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="7" width="9" height="6" rx="1.5" />
    <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
  </svg>
)

export const IconSparkle = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1.5c.3 2.9 1.4 4.6 4.5 5-3.1 1-4.2 2.6-4.5 6.5-.3-3.9-1.4-5.5-4.5-6.5 3.1-.4 4.2-2.1 4.5-5Z" />
    <path d="M13 10.5c.15 1.2.65 1.9 2 2.1-1.35.4-1.85 1.1-2 2.7-.15-1.6-.65-2.3-2-2.7 1.35-.2 1.85-.9 2-2.1Z" opacity=".8" />
  </svg>
)

export const IconMinimize = ({ className }: IconProps) => (
  <svg className={className ?? 'w-3 h-3'} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <path d="M2 6h8" />
  </svg>
)

export const IconMaximize = ({ className }: IconProps) => (
  <svg className={className ?? 'w-3 h-3'} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
  </svg>
)

export const IconRestore = ({ className }: IconProps) => (
  <svg className={className ?? 'w-3 h-3'} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="2" y="4" width="6" height="6" rx="1" />
    <path d="M4.5 4V3a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1" />
  </svg>
)

export const IconShield = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M8 1.75 13.25 3.6v4.15c0 3.1-2.2 5.4-5.25 6.5-3.05-1.1-5.25-3.4-5.25-6.5V3.6L8 1.75Z" />
  </svg>
)

export const IconBook = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3.5C6.8 2.6 5 2.4 2.75 2.5v10c2.25-.1 4.05.1 5.25 1 1.2-.9 3-1.1 5.25-1v-10C11 2.4 9.2 2.6 8 3.5Z" />
    <path d="M8 3.5v10" />
  </svg>
)

export const IconGlobe = ({ className }: IconProps) => (
  <svg className={className ?? base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="8" r="5.75" />
    <path d="M2.25 8h11.5M8 2.25c-3.5 3.6-3.5 7.9 0 11.5 3.5-3.6 3.5-7.9 0-11.5Z" />
  </svg>
)

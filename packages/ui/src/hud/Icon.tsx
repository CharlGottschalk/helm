import type { ReactNode } from 'react'
import type { IconName } from '@usetdt/helm-sdk'

const paths = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" /><rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" /></>,
  brain: <><circle cx="6" cy="6.5" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.5 6.7h7M7.2 8.7l3.6 7M16.9 9.2l-3.7 6.6" /></>,
  layers: <><path d="M12 3 2.5 8 12 13l9.5-5Z" /><path d="m2.5 13 9.5 5 9.5-5" /></>,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />,
  chat: <path d="M4 5h16v11H9.5L4 20Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  chevL: <path d="m14.5 6-6 6 6 6" />,
  chevR: <path d="m9.5 6 6 6-6 6" />,
  chevD: <path d="m6 9.5 6 6 6-6" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  note: <><path d="M6 3h9l4 4v14H6Z" /><path d="M14.5 3v4.5H19M9 12h7M9 16h5" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  arrow: <path d="M5 12h13M13 6l6 6-6 6" />,
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6Z" />,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" /></>,
  panelL: <><rect x="3" y="4" width="18" height="16" /><path d="M9 4v16" /></>,
  panelR: <><rect x="3" y="4" width="18" height="16" /><path d="M15 4v16" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  target: <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  focus: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minus: <path d="M5 12h14" />,
  drag: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
  reset: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></>,
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  doc: <><rect x="5" y="3" width="14" height="18" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>,
  hex: <path d="M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3Z" />,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /><circle cx="12" cy="12" r="6.5" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" /><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10" /></>,
  palette: <><circle cx="12" cy="12" r="8.5" /><circle cx="8.5" cy="10" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="15.5" cy="10" r="1.2" /><path d="M12 20.5c-1.4 0-2-.9-2-1.8 0-1.2 1-1.7 2.2-1.7H14a3.5 3.5 0 0 0 3.5-3.5" /></>,
} satisfies Record<IconName, ReactNode>

export type { IconName }

interface IconProps {
  name: IconName
  size?: number
  stroke?: number
  className?: string
}

export function Icon({ name, size = 16, stroke = 1.6, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

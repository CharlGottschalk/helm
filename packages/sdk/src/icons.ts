// Icon names the HUD icon set provides (@helm/ui Icon). Extensions declare one as their `icon`.
export const ICON_NAMES = ['grid', 'brain', 'layers', 'folder', 'chat', 'plus', 'x', 'chevL', 'chevR', 'chevD', 'search', 'calendar', 'check', 'note', 'pulse', 'arrow', 'bolt', 'user', 'panelL', 'panelR', 'clock', 'sliders', 'target', 'focus', 'minus', 'drag', 'reset', 'spark', 'link', 'doc', 'hex', 'cog', 'keyboard', 'palette'] as const

export type IconName = (typeof ICON_NAMES)[number]

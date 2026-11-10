// JS handles on the CSS tokens. Values are CSS variable references, so SVG
// and inline styles follow the active theme. Apply them through `style`
// (presentation attributes like fill="var(...)" aren't reliable).

export const color = {
  cyan: 'var(--c-cyan)',
  accent2: 'var(--c-accent-2)',
  amber: 'var(--c-amber)',
  red: 'var(--c-red)',
  green: 'var(--c-green)',
  violet: 'var(--c-violet)',
  blue: 'var(--c-blue)',
  text2: 'var(--c-text-2)',
} as const

import type { Tone } from '@usetdt/helm-sdk'
export type { Tone }

export const toneColor: Record<Tone, string> = {
  cyan: color.cyan,
  amber: color.amber,
  red: color.red,
  green: color.green,
  violet: color.violet,
  blue: color.blue,
  neutral: color.text2,
}

/* ── themes ───────────────────────────────────────────── */
export type ThemeId = 'hud' | 'glass' | 'cyber' | 'mono' | 'satin'

export const themes: { id: ThemeId; name: string; tagline: string }[] = [
  { id: 'hud', name: 'Holographic HUD', tagline: 'Starship bridge. Cyan signal, amber alerts, corner brackets.' },
  { id: 'glass', name: 'Aurora Glass', tagline: 'Frosted panels over a drifting aurora. Soft, rounded, calm.' },
  { id: 'cyber', name: 'Neon Cyberpunk', tagline: 'Hot magenta frames, electric cyan, hard cuts and glitches.' },
  { id: 'mono', name: 'Monolith', tagline: 'Clean-room white panels on a blueprint grid, charcoal rails, ink-black signal.' },
  { id: 'satin', name: 'Satin Slate', tagline: 'TDT’s own look: slate panels, satin edges, one gold accent. No glow.' },
]

/** Themes whose rails (sidebars, tab bar, chat dock) use a different sub-theme. */
export const chromeTheme: Partial<Record<ThemeId, string>> = { mono: 'mono-dark' }

/* ── design system docs ───────────────────────────────── */
export const swatches = [
  { group: 'Base', items: [
    { name: 'void', css: '--c-void' },
    { name: 'bg-0', css: '--c-bg-0' },
    { name: 'bg-1', css: '--c-bg-1' },
    { name: 'bg-2', css: '--c-bg-2' },
    { name: 'surface', css: '--c-surface' },
    { name: 'surface-raised', css: '--c-surface-raised' },
    { name: 'chrome', css: '--c-chrome' },
  ] },
  { group: 'Signal', items: [
    { name: 'cyan · primary', css: '--c-cyan' },
    { name: 'accent-2 · frame', css: '--c-accent-2' },
    { name: 'amber · attention', css: '--c-amber' },
    { name: 'red · critical', css: '--c-red' },
    { name: 'green · nominal', css: '--c-green' },
    { name: 'violet · concept', css: '--c-violet' },
    { name: 'blue · document', css: '--c-blue' },
  ] },
  { group: 'Text', items: [
    { name: 'text-0 · primary', css: '--c-text-0' },
    { name: 'text-1 · body', css: '--c-text-1' },
    { name: 'text-2 · muted', css: '--c-text-2' },
    { name: 'text-3 · faint', css: '--c-text-3' },
  ] },
  { group: 'Lines', items: [
    { name: 'line', css: '--c-line' },
    { name: 'line-strong', css: '--c-line-strong' },
    { name: 'line-hot', css: '--c-line-hot' },
  ] },
]

export const typeScale = [
  { token: '--fs-3xl', px: 40, family: 'display', sample: 'Command deck' },
  { token: '--fs-2xl', px: 28, family: 'display', sample: 'Workspace brain' },
  { token: '--fs-xl', px: 20, family: 'display', sample: 'Ready tasks' },
  { token: '--fs-lg', px: 16, family: 'body', sample: 'Section heading in body face' },
  { token: '--fs-base', px: 14, family: 'body', sample: 'Body copy for reading longer content.' },
  { token: '--fs-sm', px: 12, family: 'body', sample: 'Secondary text and metadata' },
  { token: '--fs-xs', px: 11, family: 'mono', sample: 'SYS.NOMINAL · 98.2%' },
  { token: '--fs-2xs', px: 10, family: 'mono', sample: 'HUD LABEL · W-01' },
]

export const spaceScale = [4, 8, 12, 16, 20, 24, 32, 40]

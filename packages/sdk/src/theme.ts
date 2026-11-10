import { KIT_CSS } from './kit.js'

// Theme contract v1 (contracts/theme.md): the tokens extensions may use.
// Sandboxed extensions receive these resolved values on :root, re-sent on theme change.

export const EXTENSION_TOKENS = [
  '--c-text-0', '--c-text-1', '--c-text-2', '--c-text-3', '--c-on-accent',
  '--c-surface', '--c-surface-raised', '--c-surface-hover', '--c-surface-active', '--c-well', '--c-chrome', '--c-bg-0',
  '--c-line', '--c-line-strong', '--c-line-hot', '--c-grid',
  '--c-cyan', '--c-cyan-ghost', '--c-accent-2', '--c-accent-hover',
  '--c-red', '--c-red-ghost', '--c-amber', '--c-amber-ghost', '--c-green', '--c-green-ghost',
  '--c-violet', '--c-violet-ghost', '--c-blue', '--c-blue-ghost',
  '--rgb-accent', '--rgb-red', '--rgb-amber', '--rgb-green', '--rgb-violet', '--rgb-blue',
  '--font-display', '--font-body', '--font-mono',
  '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-3xl',
  '--tracking-hud', '--tracking-title', '--display-weight',
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-8', '--sp-10',
  '--radius', '--radius-sm', '--clip-cut-sm', '--clip-cut-md', '--clip-cut-lg', '--shape-identity', '--skew',
  '--glow-cyan', '--glow-accent-2', '--glow-text', '--shadow-float', '--blur-panel',
  '--dur-fast', '--dur-med', '--dur-slow', '--ease-out',
] as const

/** Resolve the token values from an element (default: document root, or a themed subtree). */
export function snapshotTokens(el: Element = document.documentElement): Record<string, string> {
  const cs = getComputedStyle(el)
  return Object.fromEntries(EXTENSION_TOKENS.map((t) => [t, cs.getPropertyValue(t).trim()]))
}

/** CSS text injected into a sandboxed extension's document: tokens, base type and the UI kit. */
export function tokensCss(tokens: Record<string, string>) {
  const vars = Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')
  return `:root{${vars};color-scheme:dark}body{margin:0;font-family:var(--font-body);font-size:var(--fs-md);color:var(--c-text-1);background:transparent}` +
    `.hud-label{font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:var(--tracking-hud);text-transform:uppercase;color:var(--c-text-3)}` +
    `.mono{font-family:var(--font-mono)}.display{font-family:var(--font-display);letter-spacing:var(--tracking-title)}` +
    KIT_CSS
}

/** Semantic colour names shared by HUD primitives and data (statuses, priorities). */
export type Tone = 'cyan' | 'amber' | 'red' | 'green' | 'violet' | 'blue' | 'neutral'

/* ── theme plugins (theme.md#theme-plugins) ───────────────── */

type TokenKind = 'rgb' | 'alpha' | 'colour' | 'font' | 'length' | 'angle' | 'weight' | 'shadow' | 'filter'
const kinds = (kind: TokenKind, names: string[]) => names.map((n) => [n, kind] as const)

/** Tokens a theme plugin may set, and the kind of plain value each takes. */
export const THEME_TOKENS: Readonly<Record<string, TokenKind>> = Object.fromEntries([
  ...kinds('rgb', ['accent', 'accent-2', 'line', 'amber', 'red', 'green', 'violet', 'blue', 'surface', 'surface-raised', 'chrome', 'well'].map((n) => `--rgb-${n}`)),
  ...kinds('alpha', ['--surface-alpha', '--raised-alpha', '--chrome-alpha', '--well-alpha', '--bracket-opacity']),
  ...kinds('colour', [
    '--c-void', '--c-bg-0', '--c-bg-1', '--c-bg-2', '--c-text-0', '--c-text-1', '--c-text-2', '--c-text-3', '--c-on-accent', '--c-accent-hover',
    '--c-cyan', '--c-cyan-dim', '--c-cyan-ghost', '--c-accent-2',
    ...['amber', 'red', 'green', 'violet', 'blue'].flatMap((n) => [`--c-${n}`, `--c-${n}-ghost`]),
    '--c-surface', '--c-surface-raised', '--c-surface-hover', '--c-surface-active', '--c-chrome', '--c-well',
    '--c-line', '--c-line-strong', '--c-line-hot', '--c-grid',
  ]),
  ...kinds('font', ['--font-display', '--font-body', '--font-mono']),
  ...kinds('length', ['--radius', '--radius-sm', '--cut-sm', '--cut-md', '--cut-lg', '--bracket', '--tracking-title']),
  ...kinds('angle', ['--skew']),
  ...kinds('weight', ['--display-weight']),
  ...kinds('shadow', ['--glow-cyan', '--glow-amber', '--glow-accent-2', '--glow-text', '--shadow-float']),
  ...kinds('filter', ['--blur-panel']),
])

type RGBA = [number, number, number, number]
const NUM = '(\\d+(?:\\.\\d+)?)'
const LENGTH = new RegExp(`^(0|-?${NUM}(px|rem|em))$`)

/** Parse a plain colour: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with numbers (space or comma syntax). */
export function parseColour(v: string): RGBA | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v)
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const n = h.match(/../g)!.map((x) => parseInt(x, 16))
    return [n[0], n[1], n[2], n.length === 4 ? n[3] / 255 : 1]
  }
  const fn = /^rgba?\(\s*([^()]*)\)$/i.exec(v)
  if (!fn) return null
  const parts = fn[1].trim().split(/\s*[,/]\s*|\s+/)
  if (parts.length < 3 || parts.length > 4 || !parts.every((p) => new RegExp(`^${NUM}%?$`).test(p))) return null
  const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)))
  const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  return ch.every((c) => c <= 255) && a <= 1 ? [ch[0], ch[1], ch[2], a] : null
}

/** Split on separators outside parentheses. */
const split = (v: string, sep: RegExp) => {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const c of v) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (depth === 0 && sep.test(c)) (cur && out.push(cur), (cur = ''))
    else cur += c
  }
  return cur ? [...out, cur] : out
}

const FONT = /^("[A-Za-z0-9 _-]+"|'[A-Za-z0-9 _-]+'|[A-Za-z][A-Za-z0-9 -]*)$/

function valueOk(kind: TokenKind, v: string): boolean {
  switch (kind) {
    case 'rgb': {
      const m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(v)
      return !!m && m.slice(1).every((x) => +x <= 255)
    }
    case 'alpha': return new RegExp(`^${NUM}$`).test(v) && +v <= 1
    case 'colour': return parseColour(v) !== null
    case 'font': return v.split(',').every((f) => FONT.test(f.trim()))
    case 'length': return LENGTH.test(v)
    case 'angle': return new RegExp(`^-?${NUM}deg$`).test(v)
    case 'weight': return /^[1-9]00$/.test(v)
    case 'filter': return /^(none|blur\(\d+(\.\d+)?px\)( saturate\(\d+%\))?)$/.test(v)
    case 'shadow':
      return v === 'none' || split(v, /,/).every((s) => {
        const parts = split(s.trim(), /\s/)
        return parts.length > 0 && parts.every((p) => p === 'inset' || LENGTH.test(p) || parseColour(p) !== null)
      })
  }
}

const KIND_HINT: Record<TokenKind, string> = {
  rgb: 'three numbers 0–255, such as 94 234 255', alpha: 'a number from 0 to 1', colour: 'a colour as #hex or rgb()',
  font: 'a font stack of names, such as \'Inter\', system-ui, sans-serif', length: 'a length in px, rem or em', angle: 'an angle in deg',
  weight: 'a font weight from 100 to 900', shadow: 'none, or shadows of lengths, colours and inset', filter: 'none or blur(Npx), optionally saturate(N%)',
}

/**
 * Parse a theme token file: only `--token: value;` declarations and comments. Anything
 * else (selectors, braces, at-rules, other properties, var(), url()) is a problem.
 */
export function parseThemeTokens(text: string): { tokens: Record<string, string>; problems: string[] } {
  const tokens: Record<string, string> = {}
  const problems: string[] = []
  const body = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (/[{}@\\<]/.test(body)) problems.push('may contain only "--token: value;" declarations (no selectors, braces, at-rules or escapes)')
  for (const raw of body.split(';')) {
    const decl = raw.trim()
    if (!decl) continue
    const m = /^(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(decl)
    if (!m) {
      problems.push(`"${decl.slice(0, 40)}" is not a --token: value declaration`)
      continue
    }
    const [, name, value] = m
    const v = value.trim().replace(/\s+/g, ' ')
    const kind = THEME_TOKENS[name]
    if (!kind) problems.push(`${name} is not a theme token (theme.md lists them)`)
    else if (/url\(|var\(|expression|!important/i.test(v)) problems.push(`${name}: use a plain value, not url(), var(), expression or !important`)
    else if (!valueOk(kind, v)) problems.push(`${name}: "${v.slice(0, 60)}" is not ${KIND_HINT[kind]}`)
    else if (name in tokens) problems.push(`${name} is set more than once`)
    else tokens[name] = v
  }
  return { tokens, problems }
}

/* WCAG contrast. Unset tokens fall back to HUD, the default theme, as in the shell. */
const HUD: Record<string, string> = {
  '--rgb-accent': '94 234 255', '--rgb-surface': '8 24 38', '--surface-alpha': '0.66', '--c-bg-0': '#040a12',
  '--c-text-0': '#e8fbff', '--c-text-1': '#a6c6d2', '--c-text-2': '#93b1bd', '--c-text-3': '#7698a5', '--c-on-accent': '#040a12',
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA
const luminance = (c: RGBA) => {
  const [r, g, b] = c.slice(0, 3).map((x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(a: RGBA, b: RGBA) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Text pairs below WCAG AA (4.5:1): each text token on --c-surface (over --c-bg-0), and
 * --c-on-accent on --c-cyan. Empty means the theme meets AA for these pairs.
 */
export function themeContrast(tokens: Record<string, string>): { pair: string; ratio: number }[] {
  const t = { ...HUD, ...tokens }
  const col = (name: string, fallback: string) => parseColour(t[name] ?? fallback) ?? parseColour(fallback)!
  const bg = col('--c-bg-0', HUD['--c-bg-0'])
  const surface = over(t['--c-surface'] ? col('--c-surface', '#000') : parseColour(`rgb(${t['--rgb-surface']} / ${t['--surface-alpha']})`)!, bg)
  const cyan = over(t['--c-cyan'] ? col('--c-cyan', '#000') : parseColour(`rgb(${t['--rgb-accent']})`)!, surface)
  const pairs: [string, RGBA, RGBA][] = [
    ...['--c-text-0', '--c-text-1', '--c-text-2', '--c-text-3'].map((n) => [`${n} on --c-surface`, over(col(n, HUD[n]), surface), surface] as [string, RGBA, RGBA]),
    ['--c-on-accent on --c-cyan', over(col('--c-on-accent', HUD['--c-on-accent']), cyan), cyan],
  ]
  return pairs.map(([pair, fg, bgc]) => ({ pair, ratio: Math.round(contrastRatio(fg, bgc) * 100) / 100 })).filter((x) => x.ratio < 4.5)
}

/** A theme plugin's manifest.json (contract helm.theme/1). */
export interface ThemeManifest {
  contract: 'helm.theme/1'
  id: string
  name: string
  tagline: string
  /** token file, relative to the theme folder */
  tokens: string
  /** optional token file for the rails (sidebars, tab bar, chat dock), applied on top of `tokens` */
  chrome?: string
}

export interface ThemeCheck {
  problems: string[]
  /** contrast pairs below AA: a warning, the theme is still offered */
  warnings: string[]
  tokens: Record<string, string>
  chrome?: Record<string, string>
}

const TOKEN_FILE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.css$/

/**
 * Check a theme folder: its manifest and token files. `read(path)` returns a file of the
 * theme folder as text, or undefined when it is missing.
 */
export function validateTheme(m: unknown, read: (path: string) => string | undefined): ThemeCheck {
  const out: ThemeCheck = { problems: [], warnings: [], tokens: {} }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return { ...out, problems: ['manifest.json must be a JSON object'] }
  const t = m as Record<string, unknown>
  const p = out.problems
  if (t.contract !== 'helm.theme/1') p.push('"contract" must be "helm.theme/1"')
  if (typeof t.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(t.id)) p.push('"id" must match ^[a-z][a-z0-9-]{1,63}$')
  for (const [k, max] of [['name', 60], ['tagline', 140]] as const)
    if (typeof t[k] !== 'string' || !(t[k] as string).trim()) p.push(`"${k}" is required`)
    else if ((t[k] as string).length > max) p.push(`"${k}" is longer than ${max} characters`)
  const allowed = new Set(['contract', 'id', 'name', 'tagline', 'tokens', 'chrome'])
  for (const k of Object.keys(t)) if (!allowed.has(k)) p.push(`"${k}" is not a theme manifest field`)
  const load = (field: 'tokens' | 'chrome') => {
    const f = t[field]
    if (field === 'chrome' && f === undefined) return undefined
    if (typeof f !== 'string' || !TOKEN_FILE.test(f) || f.split('/').includes('..')) return void p.push(`"${field}" must be a relative .css path inside the theme folder`)
    const text = read(f)
    if (text === undefined) return void p.push(`${f} is missing`)
    if (text.length > 16 * 1024) return void p.push(`${f} is larger than 16 KiB`)
    const r = parseThemeTokens(text)
    r.problems.forEach((x) => p.push(`${f}: ${x}`))
    return r.tokens
  }
  out.tokens = load('tokens') ?? {}
  out.chrome = load('chrome')
  for (const [where, toks] of [['', out.tokens], ['chrome ', out.chrome && { ...out.tokens, ...out.chrome }]] as const)
    if (toks) for (const w of themeContrast(toks)) out.warnings.push(`${where}${w.pair} is ${w.ratio}:1, below WCAG AA 4.5:1`)
  return out
}

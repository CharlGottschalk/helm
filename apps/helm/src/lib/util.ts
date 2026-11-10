export { cx, initials, relTime } from '@helm/ui'

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9)
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

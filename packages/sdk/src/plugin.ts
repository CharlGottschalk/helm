// Plugin package contract v1 (docs/plugin.md): the "helm" field of a plugin's package.json.

export const PLUGIN_CONTRACT = 1

export interface HelmPluginField {
  /** Plugin contract version this package was built against. */
  contract: typeof PLUGIN_CONTRACT
  /** Bundle directories (manifest.json + entry HTML), relative to the package root. */
  widgets?: string[]
  tools?: string[]
  /** Theme folders (manifest.json + token files, docs/theme.md#theme-plugins), relative to the package root. */
  themes?: string[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SAFE_DIR = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/

/** Problems with a plugin's package.json; empty means Helm may read its bundles. */
export function validatePluginPackage(pkg: unknown): string[] {
  if (!isObj(pkg)) return ['package.json must be a JSON object']
  const p: string[] = []
  if (typeof pkg.name !== 'string' || !pkg.name) p.push('"name" is required')
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version)) p.push('"version" must be semver')
  const h = pkg.helm
  if (!isObj(h)) return [...p, '"helm" must be an object with "contract" and "widgets", "tools" and/or "themes"']
  if (h.contract !== PLUGIN_CONTRACT) p.push(`"helm.contract" must be ${PLUGIN_CONTRACT}`)
  const seen = new Set<string>()
  let count = 0
  for (const kind of ['widgets', 'tools', 'themes'] as const) {
    const list = h[kind]
    if (list === undefined) continue
    if (!Array.isArray(list)) {
      p.push(`"helm.${kind}" must be a list of directories`)
      continue
    }
    for (const dir of list) {
      count++
      if (typeof dir !== 'string' || !SAFE_DIR.test(dir) || dir.split('/').some((s) => s === '..' || s === '.'))
        p.push(`"helm.${kind}" entry ${JSON.stringify(dir)} must be a relative directory inside the package`)
      else if (seen.has(dir)) p.push(`"${dir}" is listed more than once`)
      else seen.add(dir)
    }
  }
  if (count === 0) p.push('"helm" must list at least one widget, tool or theme directory')
  return p
}

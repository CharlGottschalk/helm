// Settings contract v1 (contracts/settings.md) — types, defaults and validation.

export type ScalarValue = string | number | boolean | string[]
/** One entry of a `list` field: its sub-field values. */
export type ListItem = Record<string, ScalarValue>
export type SettingValue = ScalarValue | ListItem[]
export type SettingValues = Record<string, SettingValue>

export interface SettingOption {
  value: string
  label: string
}

/** Static options, or resolved at runtime through a declared connection. */
export type OptionsSource = (string | SettingOption)[] | { from: 'connection'; connection: string; call: string }

interface Base {
  id: string
  label: string
  help?: string
  required?: boolean
  group?: string
  /** show (and validate) the field only while a sibling field has one of these values */
  when?: { field: string; is: string | string[] }
}

export type SettingField =
  | (Base & { type: 'text'; default?: string; placeholder?: string; multiline?: boolean; pattern?: string; maxLength?: number; suggestions?: OptionsSource })
  | (Base & { type: 'select'; options: OptionsSource; default?: string })
  | (Base & { type: 'choice'; options: OptionsSource; multiple?: boolean; min?: number; max?: number; default?: string | string[] })
  | (Base & { type: 'checkbox'; default?: boolean })
  | (Base & { type: 'number'; min?: number; max?: number; step?: number; unit?: string; default?: number })
  | ListField

/** Fields a `list` entry may hold: every type except `list`. */
export type ItemField = Exclude<SettingField, ListField>

/** A repeatable group: users add, edit, reorder and remove entries of `fields`. */
export interface ListField extends Base {
  type: 'list'
  fields: ItemField[]
  min?: number
  max?: number
  /** label for the add button, e.g. "Add button" */
  addLabel?: string
  default?: ListItem[]
}

export const LIST_MAX = 50

/** Whether a field's `when` condition holds for these sibling values. */
export function isShown(field: SettingField, values: SettingValues): boolean {
  if (!field.when) return true
  const v = values[field.when.field]
  const is = Array.isArray(field.when.is) ? field.when.is : [field.when.is]
  return typeof v === 'string' && is.includes(v)
}

const SECRETISH = /(token|password|secret|apikey|api_key|credential)/i

export function normalizeOptions(options: (string | SettingOption)[]): SettingOption[] {
  return options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
}

export function isDynamic(options: OptionsSource): options is { from: 'connection'; connection: string; call: string } {
  return !Array.isArray(options)
}

/** Default value per field type, used when nothing is saved yet. */
export function defaultsFor(fields: SettingField[] = []): SettingValues {
  const out: SettingValues = {}
  for (const f of fields) {
    if (f.default !== undefined) out[f.id] = f.default
    else if (f.type === 'checkbox') out[f.id] = false
    else if (f.type === 'choice' && f.multiple) out[f.id] = []
    else if (f.type === 'list') out[f.id] = []
  }
  return out
}

/** Saved values over defaults, dropping ids the manifest no longer declares. */
export function resolveSettings(fields: SettingField[] = [], saved: SettingValues = {}): SettingValues {
  const values = defaultsFor(fields)
  for (const f of fields) if (saved[f.id] !== undefined) values[f.id] = saved[f.id]
  return values
}

/** Per-field error messages; empty object means valid. A list entry's errors are keyed `list.index.field`. */
export function validateSettings(fields: SettingField[], values: SettingValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of fields) {
    if (!isShown(f, values)) continue
    const v = values[f.id]
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    if (f.type !== 'checkbox' && f.required && empty) {
      errors[f.id] = 'Required'
      continue
    }
    if (empty) continue
    switch (f.type) {
      case 'text':
        if (typeof v !== 'string') errors[f.id] = 'Must be text'
        else if (v.length > (f.maxLength ?? 2000)) errors[f.id] = `At most ${f.maxLength ?? 2000} characters`
        else if (f.pattern && !new RegExp(f.pattern).test(v)) errors[f.id] = 'Invalid format'
        break
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) errors[f.id] = 'Must be a number'
        else if (f.min !== undefined && v < f.min) errors[f.id] = `Minimum ${f.min}`
        else if (f.max !== undefined && v > f.max) errors[f.id] = `Maximum ${f.max}`
        break
      case 'checkbox':
        if (typeof v !== 'boolean') errors[f.id] = 'Must be on or off'
        break
      case 'select':
        if (typeof v !== 'string') errors[f.id] = 'Choose one option'
        break
      case 'choice':
        if (f.multiple) {
          if (!Array.isArray(v)) errors[f.id] = 'Choose options'
          else if (f.min !== undefined && v.length < f.min) errors[f.id] = `Choose at least ${f.min}`
          else if (f.max !== undefined && v.length > f.max) errors[f.id] = `Choose at most ${f.max}`
        } else if (typeof v !== 'string') errors[f.id] = 'Choose one option'
        break
      case 'list': {
        const isItem = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x)
        if (!Array.isArray(v) || !v.every(isItem)) errors[f.id] = 'Must be a list'
        else if (v.length > Math.min(f.max ?? LIST_MAX, LIST_MAX)) errors[f.id] = `At most ${Math.min(f.max ?? LIST_MAX, LIST_MAX)} entries`
        else if (f.min !== undefined && v.length < f.min) errors[f.id] = `At least ${f.min} entries`
        else
          (v as ListItem[]).forEach((item, i) => {
            for (const [k, msg] of Object.entries(validateSettings(f.fields, item))) errors[`${f.id}.${i}.${k}`] = msg
          })
        break
      }
    }
  }
  return errors
}

/** Manifest-level checks (subset of contracts/schemas/settings.schema.json). */
export function lintSettingFields(fields: SettingField[], inList = false): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  if (fields.length > 24) problems.push('At most 24 settings')
  for (const f of fields) {
    if (f.type === 'list') {
      if (inList) problems.push(`"${f.id}": a list cannot hold another list`)
      else if (!Array.isArray(f.fields) || !f.fields.length) problems.push(`"${f.id}": a list needs fields`)
      else problems.push(...lintSettingFields(f.fields, true).map((x) => `${f.id}: ${x}`))
    }
    if (f.when && !fields.some((o) => o.id === f.when!.field && o !== f)) problems.push(`"${f.id}": when.field must name another field at the same level`)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(f.id)) problems.push(`Invalid id "${f.id}"`)
    if (ids.has(f.id)) problems.push(`Duplicate id "${f.id}"`)
    if (SECRETISH.test(f.id) || SECRETISH.test(f.label)) problems.push(`"${f.id}" looks like a secret; use a connection auth profile`)
    ids.add(f.id)
  }
  return problems
}

export function requiredMissing(fields: SettingField[] = [], values: SettingValues = {}) {
  return fields.some((f) => f.type !== 'checkbox' && f.required && isShown(f, values) && (values[f.id] === undefined || values[f.id] === ''))
}

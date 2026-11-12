// Renders any settings schema (contracts/settings.md): text, select, choice, checkbox, number, list.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  defaultsFor, isDynamic, isShown, normalizeOptions, resolveSettings, validateSettings, LIST_MAX,
  type ItemField, type ListField, type ListItem, type OptionsSource, type SettingField, type SettingOption, type SettingValues,
} from '@usetdt/helm-sdk'
import { cx } from '../../lib/util'
import { Button, Icon } from '@helm/ui'
import s from './SettingsForm.module.css'

export type OptionsResolver = (source: Extract<OptionsSource, { from: 'connection' }>) => Promise<SettingOption[]>

interface FormProps {
  fields: SettingField[]
  values: SettingValues
  onSave: (values: SettingValues) => void
  onCancel: () => void
  /** resolves dynamic option sources through the extension's declared connections */
  resolveOptions?: OptionsResolver
}

export function SettingsForm({ fields, values, onSave, onCancel, resolveOptions }: FormProps) {
  const [draft, setDraft] = useState<SettingValues>(() => resolveSettings(fields, values))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (id: string, v: SettingValues[string]) => setDraft((d) => ({ ...d, [id]: v }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found = validateSettings(fields, draft)
    setErrors(found)
    if (Object.keys(found).length === 0) onSave(draft)
    else document.getElementById(`setting-${Object.keys(found)[0]}`)?.focus()
  }

  // consecutive fields with the same group share a heading
  let lastGroup: string | undefined

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      {fields.length === 0 && <p className={s.muted}>This item has no settings.</p>}
      {fields.map((f) => {
        if (!isShown(f, draft)) return null
        const heading = f.group && f.group !== lastGroup ? <div className={s.group}>{f.group}</div> : null
        lastGroup = f.group
        return (
          <div key={f.id}>
            {heading}
            {f.type === 'list' ? (
              <ListEditor field={f} value={draft[f.id]} errors={errors} onChange={(v) => set(f.id, v)} resolveOptions={resolveOptions} />
            ) : (
              <Field field={f} value={draft[f.id]} error={errors[f.id]} onChange={(v) => set(f.id, v)} resolveOptions={resolveOptions} />
            )}
          </div>
        )
      })}
      <div className={s.actions}>
        <Button variant="subtle" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" icon="check">Save</Button>
      </div>
    </form>
  )
}

function useOptions(source: OptionsSource | undefined, resolver?: OptionsResolver) {
  const [state, setState] = useState<{ options: SettingOption[]; loading: boolean; error: string | null }>(() => ({
    options: source && !isDynamic(source) ? normalizeOptions(source) : [],
    loading: !!source && isDynamic(source),
    error: null,
  }))
  const key = source && isDynamic(source) ? `${source.connection}:${source.call}` : ''
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!source || !isDynamic(source)) return
    if (!resolver) {
      setState({ options: [], loading: false, error: 'No connection available' })
      return
    }
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    resolver(source)
      .then((options) => live && setState({ options, loading: false, error: null }))
      .catch((e: Error) => live && setState({ options: [], loading: false, error: e.message }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  return { ...state, retry: () => setAttempt((a) => a + 1) }
}

/** Entries of a `list` field: each is a card of its sub-fields, with move up/down and remove. */
function ListEditor({ field: f, value, errors, onChange, resolveOptions }: {
  field: ListField
  value: SettingValues[string] | undefined
  errors: Record<string, string>
  onChange: (v: ListItem[]) => void
  resolveOptions?: OptionsResolver
}) {
  const items = Array.isArray(value) ? (value as ListItem[]) : []
  // stable React keys while entries move, so each card keeps its own option state
  const next = useRef(0)
  const [keys, setKeys] = useState<number[]>(() => items.map(() => next.current++))
  if (keys.length !== items.length) setKeys(items.map((_, i) => keys[i] ?? next.current++))
  const max = Math.min(f.max ?? LIST_MAX, LIST_MAX)
  const id = `setting-${f.id}`
  const update = (list: ListItem[], k: number[]) => (setKeys(k), onChange(list))
  const move = (i: number, d: -1 | 1) => {
    const list = [...items], k = [...keys]
    ;[list[i], list[i + d]] = [list[i + d], list[i]]
    ;[k[i], k[i + d]] = [k[i + d], k[i]]
    update(list, k)
  }
  const titleField = f.fields.find((x) => x.type === 'text')
  return (
    <fieldset className={s.field} aria-describedby={f.help ? `${id}-help` : undefined}>
      <legend className={s.label}>{f.label}</legend>
      {f.help && <p id={`${id}-help`} className={s.help}>{f.help}</p>}
      {errors[f.id] && <p id={id} tabIndex={-1} className={s.error} role="alert">{errors[f.id]}</p>}
      {!items.length && <p className={s.muted}>Nothing here yet.</p>}
      <ol className={s.list}>
        {items.map((item, i) => {
          const name = (titleField && String(item[titleField.id] ?? '')) || `Entry ${i + 1}`
          return (
            <li key={keys[i]} className={s.listItem}>
              <div className={s.listHead}>
                <span className={s.listTitle}>{i + 1}. {name}</span>
                <Button type="button" size="sm" variant="ghost" disabled={i === 0} aria-label={`Move ${name} up`} onClick={() => move(i, -1)}>Up</Button>
                <Button type="button" size="sm" variant="ghost" disabled={i === items.length - 1} aria-label={`Move ${name} down`} onClick={() => move(i, 1)}>Down</Button>
                <Button type="button" size="sm" variant="danger" aria-label={`Remove ${name}`}
                  onClick={() => update(items.filter((_, j) => j !== i), keys.filter((_, j) => j !== i))}>Remove</Button>
              </div>
              {f.fields.map((sub) =>
                isShown(sub, item) ? (
                  <Field key={sub.id} field={sub} id={`${id}.${i}.${sub.id}`} value={item[sub.id]} error={errors[`${f.id}.${i}.${sub.id}`]} resolveOptions={resolveOptions}
                    onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [sub.id]: v as ListItem[string] } : x)))} />
                ) : null,
              )}
            </li>
          )
        })}
      </ol>
      <div>
        <Button type="button" size="sm" icon="plus" disabled={items.length >= max}
          onClick={() => update([...items, defaultsFor(f.fields) as ListItem], [...keys, next.current++])}>
          {f.addLabel ?? 'Add'}
        </Button>
      </div>
    </fieldset>
  )
}

function Field({ field: f, id = `setting-${f.id}`, value, error, onChange, resolveOptions }: {
  field: ItemField
  id?: string
  value: SettingValues[string] | undefined
  error?: string
  onChange: (v: SettingValues[string]) => void
  resolveOptions?: OptionsResolver
}) {
  const describedBy = [f.help && `${id}-help`, error && `${id}-err`].filter(Boolean).join(' ') || undefined
  const opts = useOptions('options' in f ? f.options : f.type === 'text' ? f.suggestions : undefined, resolveOptions)
  const firstRef = useRef<HTMLInputElement>(null)

  // keep a saved value visible even if the dynamic source no longer offers it
  const options = useMemo(() => {
    const list = opts.options
    if (f.type === 'select' && typeof value === 'string' && value && !list.some((o) => o.value === value)) {
      return [...list, { value, label: `${value} (unavailable)` }]
    }
    return list
  }, [opts.options, f.type, value])

  const label = (
    <label htmlFor={id} className={s.label}>
      {f.label}
      {f.required && f.type !== 'checkbox' && <span className={s.req} aria-hidden="true">*</span>}
    </label>
  )
  const help = f.help && <p id={`${id}-help`} className={s.help}>{f.help}</p>
  const err = error && <p id={`${id}-err`} className={s.error} role="alert">{error}</p>
  const optionState = opts.loading ? (
    <p className={s.help}>Loading options…</p>
  ) : opts.error ? (
    <p className={s.error}>
      {opts.error} <button type="button" className={s.retry} onClick={opts.retry}>Retry</button>
    </p>
  ) : null

  switch (f.type) {
    case 'text':
      return (
        <div className={s.field}>
          {label}
          {f.multiline ? (
            <textarea id={id} className={cx(s.input, s.textarea)} value={String(value ?? '')} placeholder={f.placeholder}
              maxLength={f.maxLength ?? 2000} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
          ) : (
            <input id={id} className={s.input} value={String(value ?? '')} placeholder={f.placeholder} list={f.suggestions ? `${id}-list` : undefined}
              maxLength={f.maxLength ?? 2000} aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
          )}
          {f.suggestions && (
            <datalist id={`${id}-list`}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </datalist>
          )}
          {help}
          {err}
        </div>
      )
    case 'number':
      return (
        <div className={s.field}>
          {label}
          <div className={s.numberRow}>
            <input id={id} type="number" className={s.input} value={value === undefined ? '' : String(value)}
              min={f.min} max={f.max} step={f.step ?? 'any'} aria-invalid={!!error} aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value === '' ? ('' as unknown as number) : Number(e.target.value))} />
            {f.unit && <span className={s.unit}>{f.unit}</span>}
          </div>
          {help}
          {err}
        </div>
      )
    case 'checkbox':
      return (
        <div className={cx(s.field, s.checkRow)}>
          <input id={id} type="checkbox" className={s.check} checked={value === true} aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.checked)} />
          <div>
            {label}
            {help}
          </div>
        </div>
      )
    case 'select':
      return (
        <div className={s.field}>
          {label}
          <select id={id} className={s.input} value={String(value ?? '')} aria-invalid={!!error} aria-describedby={describedBy}
            disabled={opts.loading} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {optionState}
          {help}
          {err}
        </div>
      )
    case 'choice': {
      const multiple = !!f.multiple
      const selected = multiple ? (Array.isArray(value) ? value : []) : value
      return (
        <fieldset className={s.field} aria-describedby={describedBy}>
          <legend className={s.label}>
            {f.label}
            {f.required && <span className={s.req} aria-hidden="true">*</span>}
          </legend>
          {optionState}
          <div className={s.choices} id={id} tabIndex={-1}>
            {options.map((o, i) => {
              const on = multiple ? (selected as string[]).includes(o.value) : selected === o.value
              return (
                <label key={o.value} className={cx(s.choice, on && s.choiceOn)}>
                  <input ref={i === 0 ? firstRef : undefined} type={multiple ? 'checkbox' : 'radio'} name={id} checked={on}
                    onChange={() => {
                      if (!multiple) return onChange(o.value)
                      const list = selected as string[]
                      onChange(on ? list.filter((v) => v !== o.value) : [...list, o.value])
                    }} />
                  {on && multiple && <Icon name="check" size={12} stroke={2.4} />}
                  {o.label}
                </label>
              )
            })}
          </div>
          {help}
          {err}
        </fieldset>
      )
    }
  }
}

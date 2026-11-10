# React bindings

`@usetdt/helm-sdk/react` is for plugins that use React. It wraps the frame bridge
([widget.md](widget.md#bridge)) and the UI kit ([kit.md](kit.md)). `react` and
`react-dom` (18 or later) are optional peer dependencies. `helm-sdk build` bundles
them only into plugins that import this entry. Thus plain HTML/JS plugins do not
include React.

To make a React plugin, run this command in a terminal:

```bash
npx @usetdt/helm-sdk create widget my-widget --react   # or: create tool my-tool --react
```

The command makes `src/<id>/main.jsx` instead of `main.js`. It also adds `react` and
`react-dom` as dev dependencies. The build bundles them into `dist/`, as it does the SDK.

```jsx
import { List, Row, State, Value, mount, useConnection, useSettings } from '@usetdt/helm-sdk/react'

function App() {
  const settings = useSettings() ?? {}
  const r = useConnection('tdt', 'tdt_workspace_status')
  if (r.status === 'loading') return <State kind="loading">Loading…</State>
  if (r.status === 'error') return <State kind="error" action={{ label: 'Retry', onClick: r.reload }}>{r.error}</State>
  return <List><Row label="Projects" value={<Value>{r.data.projects_total}</Value>} /></List>
}

mount(<App />)
```

## Functions and hooks

| Export | Does |
| --- | --- |
| `mount(node, container?)` | Renders into `container`. The default is `#app`, or `body` if `#app` does not exist. Calls `helm.ready()` after the first render. Call it one time. |
| `useHelm()` | Returns the bridge, for `openSettings`, `openTab`, `startChat` and the other functions. |
| `useSettings()` | Returns the setting values of the instance. The value is `undefined` until Helm sends the settings, immediately after ready. |
| `useTheme()` | Returns the current theme token values. The CSS variables are already applied, so most plugins only need `var(--…)`. |
| `useConnection(connection, operation, args?)` | Calls a declared operation. Returns `{ status: 'loading' \| 'error' \| 'ready', data, error, result, reload }`. It waits for the settings. It runs again when `args` change (compared as JSON), at each Helm refresh, and when you call `reload()`. If `args` is `null`, it does not make the call. |

## Components

Each component shows the kit class with the same name. Thus a React plugin looks the
same as an HTML plugin in every theme. The component passes other props to the element.

| Component | Kit |
| --- | --- |
| `State kind? action?` | `h-state`, `h-state--loading`, `h-state--error`. `action` adds a ghost button |
| `Stack`, `Muted`, `Value` | `h-stack`, `h-muted`, `h-value` |
| `List`, `Row label value? onClick?` | `h-list`, `h-row` (a `button.h-row` with `onClick`) |
| `Badge tone?` | `h-badge`, `h-badge--<tone>` |
| `Button ghost?` | `h-btn`, `h-btn--ghost` |
| `Field`, `Input` | `h-field`, `h-input` |

React shows strings as text, so connection data does not become HTML. Do not use
`dangerouslySetInnerHTML` with connection data.

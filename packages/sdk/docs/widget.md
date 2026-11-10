# Widget contract v1

A widget is a card on the 6-column grid of the Command Deck. Users add, move, resize,
configure and remove widget *instances*. If `multi` is true, one widget *type* can
have several instances. Each instance has its own settings.

## Manifest (`manifest.json`)

```json
{
  "contract": "helm.widget/1",
  "id": "jira-board",
  "name": "Jira board",
  "version": "0.1.0",
  "description": "Open issues on one Jira board, grouped by status.",
  "category": "Work",
  "icon": "grid",
  "size": { "w": 2, "h": 4, "minW": 2, "minH": 3, "maxW": 6, "maxH": 8 },
  "multi": true,
  "settings": [ ... ],
  "connections": [ ... ],
  "permissions": { "write": false },
  "entry": "index.html",
  "refresh": { "intervalSeconds": 300 }
}
```

| Field | Rules |
| --- | --- |
| `contract` | Exactly `helm.widget/1` |
| `id` | `^[a-z][a-z0-9-]{1,63}$`, unique for each origin. Generated widgets have the prefix `user-` |
| `name` | ≤ 60 characters. Helm shows it as the panel title (the theme makes it uppercase) |
| `version` | Semver |
| `description` | ≤ 240 characters. Helm shows it in the widget library |
| `category` | `Overview` \| `Work` \| `Knowledge` \| `Agents` \| `Utility` |
| `icon` | A Helm icon name (`ICON_NAMES` in `packages/sdk/src/icons.ts`) |
| `size` | Grid units. `w` is 1–6 columns. `h` is 1 or more rows (one row is 76px + a 14px gap). Defaults are 6×8 or smaller |
| `multi` | Optional. The default is `false` |
| `settings` | Optional. See [settings.md](settings.md) |
| `connections` | Optional. See [connection.md](connection.md) |
| `permissions.write` | Set to `true` only if the widget calls write operations. Helm asks the user to confirm each write |
| `entry` | The HTML file in the bundle (sandboxed widgets only) |
| `capabilities` | Optional. The only value is `orchestrate`. It lets the widget start build sessions (`helm.orchestrate.build`) and receive `helm.sessions` changes, as tools do ([tool.md](tool.md#bridge)). The user confirms each build |
| `refresh.intervalSeconds` | Optional, 30 or more. Helm sends `refresh` events at this interval. A widget can also refresh when it must |

## Anatomy and states

Helm draws the frame: the panel, the header and the resize handle. The header has the
marker, title, code, settings, remove and drag grip. The widget shows **only the
body**. Every widget must handle these states:

| State | Show |
| --- | --- |
| Unconfigured | "Configure this widget" and a button that calls the bridge `openSettings()` |
| Loading | Skeleton rows that use `--c-surface-hover`. If loading takes more than 1s, show text, not only a spinner |
| Empty | One muted sentence that tells what will appear |
| Error | A message and a Retry button. Use `error.retry` from TDT results to select the words |
| Ready | The content. It must be usable at all sizes from `minW`×`minH` to the maximum size |

The body is a size container. Use container queries (`@container`) to change the layout.

## Bridge

Sandboxed widgets communicate with Helm through `postMessage`. Helm injects a small
client that gives the `helm` object (`HelmBridge` type in `@usetdt/helm-sdk/frame`):

```js
helm.ready()                                  // after first render
helm.on('settings', (settings) => ...)        // initial + on change
helm.on('theme', (tokens) => ...)             // CSS variables already applied to :root
helm.on('refresh', () => ...)
const result = await helm.call('tdt', 'tdt_workspace_status', {})   // connection id, operation, args
helm.openSettings()
helm.openConnections()                        // Helm's Settings → Connections, for a missing service or sign-in
helm.openTab({ kind: 'project', id })         // ask Helm to open a tab; kind 'session' with orchestrate
helm.startChat('prompt text')                 // hand-off to Claude/Codex
helm.resize({ h: 5 })                         // request, Helm may refuse
```

- Helm refuses a call if the manifest does not declare its connection and operation.
- Helm validates each message: the source window, the current instance id and a size
  of 256 KiB or less.
- The iframe has `sandbox="allow-scripts"` (opaque origin). Its CSP blocks network
  access, frames, forms, popups and navigation.
- `localStorage` is not available. Use settings to keep values.

Built-in widgets are React components. They will receive the same capabilities
through `WidgetContext`. This interface is planned. `packages/sdk/src/` does not
define it yet.

## Style

Follow [theme.md](theme.md). In summary:

- Use only tokens. Helm owns the panel frame.
- Use `--fs-md` for body text and `.hud-label` for labels.
- Use `--font-display` for numbers.
- Use signal colours only for meaning: red is critical, amber is attention and green
  is nominal.

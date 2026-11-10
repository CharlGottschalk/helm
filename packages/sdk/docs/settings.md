# Settings contract v1

Widgets and tools can declare **per-instance settings**. These values make two
instances of the same type different. For example, a setting can select the Jira board
that a widget shows, or the project that a kanban tool tracks. Helm shows the settings
form. The extension receives the validated values.

## Declare settings

In the manifest, `settings` is an array of fields. The maximum is 24 fields.

```json
"settings": [
  { "id": "board", "type": "select", "label": "Board", "required": true,
    "options": { "from": "connection", "connection": "jira", "call": "boards" } },
  { "id": "columns", "type": "choice", "label": "Columns", "multiple": true,
    "options": ["To do", "In progress", "Review", "Done"], "default": ["To do", "In progress"] },
  { "id": "mine", "type": "checkbox", "label": "Only my issues", "default": true },
  { "id": "limit", "type": "number", "label": "Max issues", "min": 1, "max": 100, "step": 1, "default": 20 },
  { "id": "jql", "type": "text", "label": "Extra JQL filter", "placeholder": "labels = ui", "multiline": false }
]
```

### Common properties

| Property | Type | Notes |
| --- | --- | --- |
| `id` | string | `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, unique in the manifest |
| `type` | `text` \| `select` \| `choice` \| `checkbox` \| `number` | |
| `label` | string ≤ 120 | Helm shows it above the control |
| `help` | string ≤ 400 | Optional help text below the control |
| `required` | boolean | The default is `false`. A `checkbox` is never required, because `false` is a valid value |
| `default` | per type | Helm validates it as it validates a user value. A default value does not give consent to do an action |
| `group` | string ≤ 60 | Optional section heading. Helm puts consecutive fields with the same group together |

### Field types

| Type | Value | Extra properties | Control |
| --- | --- | --- | --- |
| `text` | string ≤ 2000 | `placeholder`, `multiline` (bool), `pattern` (regex), `maxLength` | Input or textarea |
| `select` | string | `options` (see below) | Dropdown, one value |
| `choice` | string, or string[] when `multiple` | `options`, `multiple` (bool), `min`/`max` selections | Radio group, or checkbox group when `multiple` |
| `checkbox` | boolean | — | Single checkbox/toggle |
| `number` | finite number | `min`, `max`, `step` (> 0), `unit` (string ≤ 16) | Number input |

### Options

For `select` and `choice`, `options` is one of these:

- A static array. The items are strings (1–100, unique, each ≤ 200 characters) or
  `{ "value": string, "label": string }` objects.
- A **dynamic source**: `{ "from": "connection", "connection": "<id>", "call": "<call-id>" }`.
  Helm gets the options through a connection that the same manifest declares (see
  [connection.md](connection.md)). The call must return `[{ value, label }]`.

For a dynamic source, Helm shows a loading state, and an error with a retry button.
If a saved value is not in the options, Helm keeps it and marks it "unavailable".
Helm does not remove it without a notice.

## Rules

- **Do not keep secrets in settings.** API tokens and passwords belong to the
  connection. Helm keeps them outside the workspace (see connection.md). Validation
  refuses a field whose id or label suggests a secret (`token`, `password`, `secret`,
  `key`).
- Helm saves the settings of each instance with the dashboard layout or the tool tab.
  Users can edit the settings. Changes apply immediately, without a restart.
- If required settings are missing, the extension must show a useful message. Show a
  short "Configure this widget" message and a button that opens the settings.
- Helm validates the values before they go to the extension. The extension receives
  only declared ids, with values of the declared types.

## Runtime

Helm gives the settings in the render context (`ctx.settings`). When the settings
change, Helm sends a `settings` bridge event. Built-in React extensions read
`useSettings()`. See `packages/sdk/src/settings.ts`. The form is in
`apps/helm/src/components/settings/SettingsForm.tsx`.

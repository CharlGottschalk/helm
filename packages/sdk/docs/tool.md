# Tool contract v1

A **tool** is a full-size workspace application in a tab. It opens beside the Command
Deck, the brain and the project tabs. Examples are a kanban board, a decision log and
a release checklist. A widget is a card that shows information quickly. A tool is
where you do work.

## Manifest

```json
{
  "contract": "helm.tool/1",
  "id": "kanban",
  "name": "Kanban",
  "version": "0.1.0",
  "description": "Software-production tasks by status; start builds from ready cards.",
  "icon": "grid",
  "multi": true,
  "settings": [
    { "id": "project", "type": "select", "label": "Project", "required": true,
      "options": { "from": "connection", "connection": "tdt", "call": "projects" } },
    { "id": "showCancelled", "type": "checkbox", "label": "Show cancelled", "default": false }
  ],
  "connections": [ { "id": "tdt", "kind": "tdt-mcp", "operations": ["tdt_project_list"] } ],
  "capabilities": ["orchestrate"],
  "permissions": { "write": true },
  "entry": "index.html"
}
```

The field rules are the same as in [widget.md](widget.md), with these differences:

| Field | Rules |
| --- | --- |
| `contract` | Exactly `helm.tool/1` |
| `multi` | If `true`, users can open several instances. Each tab has its own settings |
| `capabilities` | Optional host features: `orchestrate` (start build sessions), `terminal` (open a workspace terminal tab), `chat` (hand-off). Helm refuses capabilities that the manifest does not declare |
| no `size` | Tools fill the tab viewport |

## Instances and tabs

- When a user opens a tool, Helm creates an instance `{ id, type, settings }`. Helm
  saves the instance with the tab set of the workspace.
- The tab title is the tool name. If the tool has a required setting, the title also
  shows the value of the first one, for example `Kanban · Atlas`.
- When a user closes a tab, the instance stays in "Recent tools". It stays there until
  the user removes it.
- Tools appear in the **Tools** group of the left rail and in the tool library.

## Layout

Helm shows the tab. The tool fills the whole viewport below the tab bar.

- Use the standard page header: a title, a `.hud-label` eyebrow and actions on the right.
- Put `Panel`s or columns in the page.
- Add 140px of padding at the bottom. The floating chat dock covers the bottom of tools.

## Bridge

Tools get all of the widget bridge, and these functions:

```js
helm.orchestrate.build({ projectId, taskId, host })   // requires capability "orchestrate"; host optional, the user confirms
helm.sessions.on('change', (sessions) => ...)         // session status for cards
helm.openTerminal({ cwd })                            // requires "terminal"; cwd must be inside the workspace
```

An orchestration call starts a host session, which appears in the right panel. The
tool must show the status of the session. For example, a card shows "building" while
its session runs.

### Moving a task into Doing

When a user moves a card into Doing, a board can show one Helm dialog. In that dialog,
the user selects one of two actions: start a build, or only change the status of the
task.

```js
const r = await helm.orchestrate.build({ projectId, taskId, host }, {
  orWrite: { connection: 'tasks', operation: 'write', args: { project: projectId, path, text, expected_sha256 } },
})
// r.choice: 'cancel' | 'write' | 'build'
```

- This path needs the `orchestrate` capability. `orWrite` must be a declared write:
  - a `files` `write`,
  - an `http` call with `"write": true`, or
  - an `mcp` tool listed in `writes`.

  Thus the manifest also needs `"permissions": { "write": true }`. Helm refuses a read,
  an undeclared operation or a different kind. A status change in an external tracker
  uses the same path, for example a Linear `issueUpdate`.
- First, Helm confirms the write with the server. If `expected_sha256` is stale, the
  call returns `{ ok: false, write: { error: { code: 'conflict' } } }` and Helm shows
  no dialog.
- Then Helm shows the task, the exact write and the build host. The write is shown as a
  line diff, a request or tool arguments, as in [Writes](connection.md#writes). The
  dialog has three buttons: Cancel (focused), **Move only** and **Move and start build**.
  On this path, this dialog replaces the usual build confirmation.
- Only one thing occurs:
  - `cancel` changes nothing (`error: 'Declined by the user'`).
  - `write` runs the confirmed write and returns its result in `write`. `ok` and
    `error` follow that result. For `http`, the result is an `HttpResult`. Its `ok`
    shows only the HTTP status, so check GraphQL `errors` yourself.
  - `build` starts the build session and writes nothing. The build skill sets the
    status itself.

# Configuration

Helm reads its configuration from `~/.helm/config.json`. If the file does not exist,
Helm uses the default values. Helm creates the file when you add your first
workspace, or when an automatic TDT install sets `tdtCommand`. Helm then changes only
those fields and keeps all other fields.

## The configuration file

```json
{
  "port": 4317,
  "tdtCommand": "tdt",
  "hosts": { "claude": "claude", "codex": "codex" },
  "defaultHost": "claude",
  "workspaces": [{ "id": "ws-labs", "name": "Helm Labs", "path": "/abs/path/to/workspace", "profile": "read-only" }]
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `port` | `4317` | The port of the Helm server |
| `tdtCommand` | `"tdt"` | The command that starts TDT. Use an absolute path if `tdt` is not on your `PATH` |
| `hosts` | `{ "claude": "claude", "codex": "codex" }` | The commands that start Claude Code and Codex |
| `defaultHost` | `"claude"` | The host that Helm selects first: `"claude"` or `"codex"` |
| `workspaces` | `[]` | Your TDT workspaces. See below |

You can leave out any field. Helm uses the default value for each missing field. In
`hosts`, you can set only one of the two commands.

Helm does not validate the field values. Check the values yourself after you edit the
file. If Helm cannot read the file, it prints `[helm] ignoring unreadable …` and uses
the default values.

## Workspaces

Each entry in `workspaces` has these fields:

| Field | Meaning |
| --- | --- |
| `id` | A short name for the workspace, used in Helm URLs, for example `ws-labs` |
| `name` | The name that Helm shows |
| `path` | The absolute path of the TDT workspace root |
| `profile` | The TDT access profile: `"read-only"` or `"everyday"` |

To add a workspace, use the setup screen, **Add workspace** in the workspace
switcher, or `helm workspace add`. See
[Getting started](getting-started.md#add-a-workspace). Helm gives a new workspace an
`id` made from its name and the `read-only` profile.

Helm has no screen to edit or remove workspaces yet. To change or remove a
workspace, edit the file and start Helm again. `helm workspace list` shows your
workspaces.

For each workspace, Helm starts TDT with this command:

```sh
tdt --workspace <path> mcp serve --profile <profile>
```

### Profiles

- `read-only` lets Helm read the workspace. Use this profile unless you need writes.
- `everyday` also gives Helm the TDT write tools. Some actions need it, for example
  opening an interview. Set this profile only for workspaces where you want these
  actions.

Helm reads the configuration file when it starts. To change a profile, edit the
`profile` field of the workspace entry, then restart Helm.

## Environment variables

| Variable | Effect |
| --- | --- |
| `HELM_HOME` | Use this folder instead of `~/.helm` |
| `HELM_PORT` | Use this port instead of the `port` field |
| `HELM_TOKEN` | Use this token instead of a new random token at each start |
| `HELM_KEYCHAIN=off` | Keep credentials in a file, not in the keychain. See [Security](security.md#credentials) |
| `SHELL` | The shell for terminals on Linux and macOS. The default is `/bin/bash` |
| `COMSPEC` | The shell for terminals on Windows. The default is `powershell.exe` |

## Windows hosts

On Windows, npm installs command-line tools as `.cmd` files. If Claude Code does not
start in a Helm terminal, set the host command to the `.cmd` name:

```json
{ "hosts": { "claude": "claude.cmd", "codex": "codex.cmd" } }
```

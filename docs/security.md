# Security

Helm runs on your computer only. This guide tells how Helm protects the server, your
credentials and your workspace.

## The local server

- Helm listens only on `127.0.0.1`. Other computers cannot connect to it.
- Each request to the Helm API must have the private token. Helm makes a new random
  token at each start, unless you set `HELM_TOKEN`.
- Helm accepts a request only if its `Host` header is `127.0.0.1:<port>` or
  `localhost:<port>`. If the request has an `Origin` header, the origin must also be
  one of these two.
- Helm sends a strict Content Security Policy. The page can load scripts, styles,
  data and frames only from Helm itself.

Keep the Helm URL private. The token in it gives full access to Helm while that token
is valid. This includes the setup screen: it can list the folders that your user
account can read, make folders, and run `tdt init`, `tdt doctor` and
`pipx install 'thisdamnthing[mcp]'`. Helm runs these commands directly, never through
a shell, and only on a folder that you choose.

## Credentials

Helm keeps passwords, API tokens and OAuth tokens outside your workspaces and projects.

- On Linux, Helm uses the system keychain through `secret-tool`.
- On macOS and Windows, or if you set `HELM_KEYCHAIN=off`, Helm uses the file
  `~/.helm/credentials.json`. Only your user account can read it (mode 0600).

Helm never sends credentials to the browser, to a plugin or to a workspace.

## Files in `~/.helm`

| File or folder | Contents |
| --- | --- |
| `config.json` | Your configuration. See [Configuration](configuration.md) |
| `credentials.json` | Credentials, if Helm does not use the keychain |
| `db.json` | Database connection profiles |
| `http.json` | Service profiles for HTTP connections |
| `mcp.json` | MCP server profiles |
| `sessions/` | Ended sessions (Helm keeps the last 200) |
| `usage/` | Helm's Claude status line script, the last usage numbers it saved, and each Claude session's context-window numbers (`usage/context/`) |
| `plugins/` | Installed plugins and their approval state |

Helm creates this folder so that only your user account can open it (mode 0700).

## Agent usage limits

To show your plan's usage limits (see [Sessions](sessions.md#usage-limits)), Helm:

- reads the access token of your Claude Code login, from `~/.claude/.credentials.json`
  or, on macOS, the keychain. Helm only reads it. It never renews, changes or copies
  the login.
- sends that token only to Claude's usage service at `api.anthropic.com`.
- runs `codex app-server` and asks it for the rate limits. Codex uses its own login.
- keeps the token in the server. The browser receives only percentages and reset
  times.

To stop all of this, turn off **Show agent usage limits** in **Settings →
Appearance**.

## Plugins

Plugins run in a sandboxed frame. A plugin cannot send network requests or read your
files directly. It can use only the connections that its manifest declares, and only
after you approve them. Each write needs your confirmation in a Helm dialog. See
[Plugins](plugins.md).

Data from connections is not trusted. Helm and plugins show it as text. They do not
follow instructions in it.

## Terminals

A workspace terminal starts in the workspace folder. Helm refuses a start folder
outside the workspace. The terminal itself is not sandboxed: commands in it run with
your user permissions.

# Getting started

Helm is a local Command Deck for ThisDamnThing (TDT) workspaces. It runs a server on
your computer and shows a dashboard in your browser. Helm is in **beta**. Its features
and configuration can change between releases.

## Requirements

- Node 24 or later.
- For live data: TDT with the MCP extra. Install it with
  `pipx install 'thisdamnthing[mcp]'`.
- For chat hand-offs and builds: Claude Code, Codex or both on your `PATH`.

Without TDT, Helm still starts. It then shows sample data. See
[Troubleshooting](troubleshooting.md#offline-mode).

## Install Helm

Install Helm from npm:

```sh
npm install -g @usetdt/helm
```

On Linux, the workspace terminal needs the install script of node-pty. npm skips
install scripts in a global install, so allow that one:

```sh
npm install -g @usetdt/helm --allow-scripts=node-pty
```

The install adds the `helm` command to your `PATH`. If npm reports skipped install
scripts, see [Troubleshooting](troubleshooting.md#install-scripts). To run Helm from
its source code instead, see `DEVELOPMENT.md` in the Helm repository.

## Add a workspace

Before you start Helm, tell it where your TDT workspace is.

1. Create the file `~/.helm/config.json`.
2. Add your workspace. Replace `/abs/path/to/workspace` with the absolute path of
   your TDT workspace:

   ```json
   {
     "workspaces": [{ "id": "my-workspace", "name": "My workspace", "path": "/abs/path/to/workspace", "profile": "read-only" }]
   }
   ```

[Configuration](configuration.md) describes all fields.

## Start Helm

1. Start the server:

   ```sh
   helm
   ```

2. The server prints a line like this one:

   ```text
   [helm] Command Deck ready → http://127.0.0.1:4317/#token=<token>
   ```

3. Open that URL in your browser. Helm does not open the browser for you.

The URL contains a private token. Helm makes a new token each time it starts, so use
the URL from the current start. Do not share the URL. After the page loads, Helm
removes the token from the address bar and keeps it for that browser tab.

To check the result, look at the tab bar. When Helm is connected, it shows
"SYS NOMINAL". If it shows "OFFLINE · SAMPLE DATA", see
[Troubleshooting](troubleshooting.md#offline-mode).

## Stop Helm

In the terminal where Helm runs, press Ctrl+C. Helm closes its sessions and
terminals, and then it stops.

## Next steps

- [Dashboard and widgets](dashboard.md)
- [Sessions and chat](sessions.md)
- [Plugins](plugins.md)

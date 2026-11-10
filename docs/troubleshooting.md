# Troubleshooting

## Offline mode

If Helm cannot connect to its server, it shows sample data. The tab bar then shows
"OFFLINE · SAMPLE DATA". Helm goes offline in these conditions:

- The URL has no token, for example because you opened `http://127.0.0.1:4317/`
  without `#token=…`.
- The server is not running, or it stopped.

To connect again:

1. Make sure that the server runs. If it does not run, start it with `npm start`.
2. Open the URL that the server printed at its last start.

In offline mode, changes affect only the sample data.

## TDT is unavailable

If Helm cannot start TDT for a workspace, it shows this message:

```text
TDT is unavailable for this workspace. Check that `tdt` is on PATH and installed with the mcp extra: pipx install 'thisdamnthing[mcp]'
```

1. Run `tdt --version` in a terminal. If the command is not found, install TDT, or
   set `tdtCommand` to its absolute path. See [Configuration](configuration.md).
2. Make sure that TDT has the MCP extra: `pipx install 'thisdamnthing[mcp]'`.
3. Start Helm again.

The server log also shows `[helm] tdt mcp for <workspace> failed: …` with the cause.

## The workspace has no TDT harness

If Helm shows "This folder has no TDT harness (.tdt/config.json).", the `path` of that
workspace is not a TDT workspace root. Correct the `path` in `~/.helm/config.json` and
start Helm again.

## No workspaces configured

If Helm shows "No workspaces configured. Add one to ~/.helm/config.json.", add a
workspace as [Getting started](getting-started.md#add-a-workspace) describes.

## Install scripts

npm 11 can skip the install scripts of esbuild and node-pty. Helm works without them,
except the workspace terminal on Linux: node-pty has no prebuilt binary for Linux, so
it must run its install script.

- For a global install, install again with
  `npm install -g @usetdt/helm --allow-scripts=node-pty`.
- For a source checkout, review the scripts, run `npm approve-scripts esbuild node-pty`,
  then run `npm install` again.

If node-pty is missing, Helm reports: "node-pty is not installed or failed to build;
terminals are unavailable".

## The host does not start on Windows

If Claude Code or Codex does not start in a Helm terminal on Windows, set the host
command to its `.cmd` name. See [Configuration](configuration.md#windows-hosts).

## Frontend not built

If the browser shows "Frontend not built." in a source checkout, run `npm run build`,
then `npm start`. A global npm install includes the built frontend.

## The port is in use

Helm does not report a clear message if another program uses its port. If Helm stops
at start, set a different port with the `port` field or `HELM_PORT`.

## A settings file is unreadable

If Helm reports that `db.json`, `http.json`, `mcp.json` or `credentials.json` is
unreadable, correct the JSON in that file in `~/.helm`. You can also remove the file.
If you remove it, Helm forgets the profiles or credentials in it.

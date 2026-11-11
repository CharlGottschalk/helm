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

## Add a workspace

If you have no workspace yet, Helm opens the setup screen. It has these steps:

1. **Install TDT.** Helm checks that it can run TDT. If TDT is missing, Helm shows
   two options:
   - **Install automatically.** This option shows when pipx is installed. Helm shows
     the command `pipx install 'thisdamnthing[mcp]'`. Click **Run install** to run
     it. Helm shows the output. If pipx changed your `PATH`, open a new terminal
     before you run `tdt` yourself. Helm can continue without a restart.
   - **Install it yourself.** A guide for your operating system. Helm does not
     install Python or pipx.

   When TDT is installed, click **Check again**.
2. **Choose a folder.** Browse to a folder. You can open any folder on your
   computer. Helm marks the folders that are TDT workspaces. To make a folder, type
   a name and click **New folder**.
3. **Connect or create.**
   - If the folder is a TDT workspace, click **Connect this workspace**.
   - If it is not, click **Create a TDT workspace here**. Helm runs `tdt init` and
     then `tdt doctor`. If the folder already contains files, Helm asks you to
     confirm first. Keep TDT workspaces outside your code projects.

Helm adds the workspace to `~/.helm/config.json` with the `read-only` profile, and
then opens it. To add more workspaces later, open the workspace switcher at the top
of the left rail and click **Add workspace**.

You can also add a workspace from a terminal:

```sh
helm workspace add /path/to/workspace            # connect an existing workspace
helm workspace add /path/to/folder --init        # create a workspace there first
helm workspace list                              # show your workspaces
```

Use `--name <name>` to set the name that Helm shows. If Helm is running, restart it
to see a workspace that you added from a terminal. [Configuration](configuration.md)
describes the workspace fields.

## Stop Helm

In the terminal where Helm runs, press Ctrl+C. Helm closes its sessions and
terminals, and then it stops.

## Next steps

- [Dashboard and widgets](dashboard.md)
- [Sessions and chat](sessions.md)
- [Plugins](plugins.md)

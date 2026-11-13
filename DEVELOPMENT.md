# Developing Helm

This file is for people who work on Helm itself. To install and use Helm, see the
[README](README.md) and the user guides at [helm.usetdt.com](https://helm.usetdt.com).

## Requirements

- Node 24 or later. Database connections use the built-in `node:sqlite` module.
- For live data: TDT with the MCP extra (`pipx install 'thisdamnthing[mcp]'`). Only
  that extra includes pydantic, which the TDT MCP tools need.
- For hand-offs and builds: Claude Code, Codex or both on `PATH`.

## Checks

```sh
npm run typecheck                  # all workspaces (builds the SDK first)
npm run build
npm run check -w @usetdt/helm-sdk  # SDK validators and CLI
npm run check:plugins -w @usetdt/helm   # also check:files, check:db, check:connections, check:oauth
```

## Contributing

`main` is protected. Make changes on a branch, use
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …)
and open a pull request.

## Release

GitHub Actions publishes the two npm packages with provenance
(`.github/workflows/publish.yml`). Each package has its own tag: `helm-sdk-vX.Y.Z` for
`@usetdt/helm-sdk` (`packages/sdk`) and `helm-vX.Y.Z` for `@usetdt/helm` (`apps/helm`).

1. In a pull request, set `version` in the package's `package.json`. If you release the
   SDK and Helm together, release the SDK first and raise Helm's `@usetdt/helm-sdk` range.
2. Merge the pull request, then tag the merged commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag helm-vX.Y.Z
   git push origin helm-vX.Y.Z
   ```

3. The workflow checks that the tag matches the package version and is on `main`, runs
   `npm ci`, typecheck, build and the SDK check, and then runs `npm publish --provenance`.
4. Check the release: the npm page of the version shows a provenance statement, and
   `npm audit signatures` in a project that installs it passes.
5. Create the GitHub pre-release for the tag.

To test without publishing, run the workflow by hand (Actions → Publish to npm → Run
workflow) and choose the package. A manual run is always a dry run: it runs the same
checks and build, then lists the package contents with `npm pack --dry-run`. Only a
real release shows the provenance statement.

No npm token is stored in the repository or in GitHub. The workflow uses npm trusted
publishing (OIDC). One-time setup by the npm package owner, for each package on
npmjs.com (package → Settings → Trusted publishing → GitHub Actions):
organization or user `CharlGottschalk`, repository `helm`, workflow file `publish.yml`,
environment `release`. Optionally add required reviewers to the `release` environment in
the GitHub repository settings, so that each publish waits for approval.

## Run Helm

Run these commands from the repository root:

```sh
npm install
npm run dev            # frontend only, offline mode on mock data → http://localhost:5173
npm run dev:server     # + local server (token "dev") → http://localhost:5173/#token=dev
npm run build && npm start   # production: one server on :4317, prints the private URL
```

- `npm run dev` starts only the frontend, in offline mode with sample data.
- `npm run dev:server` also starts the local server, with the token `dev`.
- `npm run build && npm start` starts one production server on port 4317. The server
  prints the private URL. Open that URL in a browser.

## Configure workspaces

Add workspaces through Helm's onboarding (shown when none are configured, and from the
workspace switcher's Add workspace), with `helm workspace add <path> [--name <n>] [--init]`
and `helm workspace list`, or by editing `~/.helm/config.json`. To use a different folder,
set `HELM_HOME`.

```json
{
  "port": 4317,
  "tdtCommand": "tdt",
  "hosts": { "claude": "claude", "codex": "codex" },
  "defaultHost": "claude",
  "workspaces": [{ "id": "ws-labs", "name": "Helm Labs", "path": "/abs/path/to/workspace", "profile": "read-only" }]
}
```

Replace `/abs/path/to/workspace` with the absolute path of your TDT workspace.

### Install notes

- npm 11 has an allow-scripts check. This check skips the install scripts for
  **esbuild** and **node-pty**. During tests, the build still worked, and node-pty
  loaded its prebuilt binary on Windows. If one of the two fails on your computer,
  review the scripts. Then run `npm approve-scripts esbuild node-pty`.
- **Windows hosts:** npm installs CLIs as `.cmd` shims. If `claude` does not start
  in a PTY, set `"hosts": { "claude": "claude.cmd" }`. Do the same for Codex.

## Current status

| Area | State |
| --- | --- |
| Shell, dashboard grid, widget library, 5 themes, settings modal | Working. Online, the 13 built-in widgets read live TDT data (`packages/widgets/src/dashboard/live.tsx`). Offline, 10 widgets show sample data. Review queue, Stacks & skills and Relays need live data. Offline, they show a message that they need the server |
| Brain graph | Live from `tdt_brain_graph` (TDT 0.1.12+), cached by revision. A node opens its record. Search finds titles. Through `tdt_brain_search`, search also finds note text. Offline, the graph shows sample data, with a label in the stats bar |
| Local server: loopback, bearer token, Host/Origin checks, CSP, static serving | Working |
| Workspace terminals (node-pty + xterm.js, cwd limited to the workspace) | Working (verified on Windows) |
| Chat hand-off and orchestrated builds as PTY sessions; right-panel sessions; session view | Working with the host CLI. Helm infers the `waiting` status from output idle time. Ended sessions stay in `~/.helm/sessions/` |
| Instance settings (text, select, choice, checkbox, number) for widgets and tools | Working (`SettingsForm`, contracts, schemas) |
| Tools as tabs; Kanban, Ready tasks and Task pipeline | From the separate `@usetdt/helm-plugin-software-production` plugin. The plugin reads tasks through `files` connections and builds through `orchestrate`. Helm itself does not parse task files. A Kanban move writes the `Status:` line through a confirmed `files` write. For a move into Doing, Helm's dialog also offers the build. The session view shows the handoff of the build skill |
| Brain record reader/editor (Read + Edit tabs) | Live reads (candidate, knowledge, scratchpad, project). Online, Helm sends edits and candidate reviews to Claude or Codex, which run the TDT preview and confirm steps. Offline, edits change only sample data |
| Chat (floating bar + chat tabs) | Hand-off only, to the host that the user selects in the picker. Offline, Helm keeps the prompt and tells the user how to hand it off |
| MCP bridge to `tdt mcp serve` | Working with a real workspace on Linux (tdt 0.1.11). The workspace switcher, project rail and project tabs are live. Not tested on Windows |
| Contracts, JSON schemas, examples, `tdt-helm` stack | Written. The SDK has an example widget/tool plugin and an example theme plugin. The `tdt-helm` stack (own repository) has skills for widgets, tools and themes |
| Sandboxed extensions from plugins (`helm plugin`, Settings → Plugins) and `work/helm/` | Working (`server/src/extensions.ts`, `packages/widgets/src/sandbox.tsx`). Each extension runs in an opaque-origin iframe with its own CSP and the theme tokens. The `helm` bridge permits only the declared operations of `tdt-mcp`, `mcp`, `http`, `files` and `db` connections. `tdt-mcp` operations must be read-only. A declared write runs only after the user confirms Helm's dialog (`server/src/confirm.ts`). The widget library lists manifests that are not valid. Helm refuses extension terminals for now |
| Theme plugins (`helm.themes`, token files only) | Working (`packages/sdk/src/theme.ts` validation and contrast, `server/src/plugins.ts` `listThemes`, `GET /api/themes`). Approved themes appear in Appearance → Theme in every workspace, with a Below AA warning when text contrast is under 4.5:1. A removed or unapproved theme falls back to HUD |
| Database connections (`db` kind: SQLite, Postgres, MySQL) | Working (`server/src/db.ts`, `server/src/secrets.ts`). Manage profiles in Settings → Connections or with `helm db` (add, remove, list, test). Passwords go in the keychain (`secret-tool`) or in `~/.helm/credentials.json` (0600). Read-only by default, with limits of 5 s, 1000 rows and 1 MiB. A declared `write: true` query runs only after the user confirms it. No TLS or tunnels yet |
| DB explorer (built-in tool) | Working (`packages/widgets/src/tools/DbExplorer.tsx`, `/api/db/profiles/:name/{schema,query}`). Shows tables and columns, pages through tables and runs ad hoc SQL (one statement). It has the same read-only guards and limits. A write toggle for each connection adds Run write. The user confirms the toggle, and also each statement (`/write`). Only the shell has this tool. Plugins cannot send SQL. Temporary tables (SQLite, MySQL) are permitted. They are removed when the connection closes |

## Continuation points (search for `TODO` in code)

1. **Live data:** The shell and the 13 built-in widgets are live (`useTdt` /
   `useServerData` in `packages/client/src/index.ts`, cached for 30 s). Helm uses the
   sample data in `packages/client/src/offline/` only offline. The TDT list tools give
   no timestamps for scratchpad notes and candidates. Thus Activity uses captures,
   reminders and projects.
2. **External task systems:** `FileTaskSource` (`apps/helm/server/src/tasks.ts`) reads
   only internal tasks. External `task_system` configs (Jira, Linear, …) need a source
   that uses a connector.
3. **Session status:** Helm infers `waiting` from terminal idle time
   (`apps/helm/server/src/sessions.ts`). A host hook or headless mode
   (`agents/hosts.ts`) would make it exact.
4. **Writes:** v1 writes nothing to TDT. Write intents become hand-off prompts
   (`editHandoffPrompt`, `reviewHandoffPrompt` in `apps/helm/src/services/records.ts`).
   The records endpoint for the everyday profile stays for a future opt-in. It uses a
   confirmation and a server-side `user_instruction` (`apps/helm/server/src/index.ts`).
5. **Extensions:** `packages/widgets/src/sandbox.tsx` refuses these features for now:
   TDT writes from sandboxed extensions (confirmation and server-side
   `user_instruction`) and `openTerminal`.
6. **Terminal confinement:** An OS sandbox through `SandboxPolicy`
   (`apps/helm/server/src/terminal/pty.ts`).
7. **Config UI:** Remove and edit workspaces (adding is done), opt in to the everyday profile, a host
   picker, and HTTP auth profiles in the OS keychain.
8. **`tdt-helm` stack:** The stack is in its own repository (`tdt-helm`, Apache-2.0).
   Its skills make plugins with `npx @usetdt/helm-sdk` and read the bundled docs of
   the SDK.

## Layout

The repository uses npm workspaces and Turborepo. Dependencies go in one direction:
`apps/*` → `widgets` → `client`/`ui` → `sdk`. Packages never import from `apps/`.

```text
apps/helm/                 The published `helm` package (bin: helm)
  server/                  Local Node server — config, MCP bridge, PTYs, sessions, orchestrator
  src/services/            Option resolvers, record service
  src/components/          Shell, settings form/dialog, chat dock
  src/views/               dashboard/ (grid, library), tools/ (tool host), session/, terminal/, graph/, …
  src/state/widgetHost.tsx Provides the @helm/widgets host interface from the app store
packages/sdk/        @usetdt/helm-sdk — docs/ (contracts + schemas/, examples/), src/ (TypeScript side), bin/ + templates/ (helm-sdk CLI)
packages/ui/               @helm/ui — HUD primitives, tokens.ts, styles/ (tokens.css, themes.css, fonts.css)
packages/client/           @helm/client — server client behind a Transport (HTTP/WS, offline); offline/ sample data
packages/widgets/          @helm/widgets — built-in widgets, tool and widget registries (tools come from plugins), sandbox host, host interface
```

The internal packages contain TypeScript source. Vite bundles them into
`apps/helm/dist`. Thus `npm pack -w @usetdt/helm` makes a tarball that needs
only packages from npm, including `@usetdt/helm-sdk`, which the server uses at
run time. The build copies the contract docs into it.

# Helm: Command Deck for ThisDamnThing

> **Beta.** Helm and its SDK are in beta (0.x). Expect bugs, and changes between versions.
> Report problems in [GitHub issues](https://github.com/CharlGottschalk/helm/issues).

Helm is a local Command Deck for [ThisDamnThing](https://usetdt.com) (TDT) workspaces.
It has themes, and it shows a dashboard of widgets, tabbed tools, a brain graph, agent
sessions with their usage limits, a token usage report and a workspace terminal. Helm runs a server on `127.0.0.1`, communicates with
TDT through `tdt mcp serve`, and sends chat and builds to Claude Code or Codex. Helm
never runs a model itself.

## Install

Helm needs Node 24 or later.

```sh
npm install -g @usetdt/helm
```

On Linux, the workspace terminal needs the node-pty install script. npm skips install
scripts in a global install by default, so allow it:

```sh
npm install -g @usetdt/helm --allow-scripts=node-pty
```

For live workspace data, install TDT with the MCP extra:

```sh
pipx install 'thisdamnthing[mcp]'
```

Add your workspace to Helm's configuration file, then start Helm:

```sh
helm
```

Helm prints a private URL. Open it in your browser. The
[getting started guide](https://helm.usetdt.com/docs/getting-started) gives the full
procedure.

## Make plugins

Widgets, tools and themes are npm plugins built on the SDK:

```sh
npx @usetdt/helm-sdk create widget my-widget   # or: tool, theme
```

With the `tdt-helm` stack, your agent makes plugins from a prompt.

## Links

| | |
| --- | --- |
| Helm site and user guides | [helm.usetdt.com](https://helm.usetdt.com) |
| Plugin SDK and contracts | [helm.usetdt.com/docs/sdk](https://helm.usetdt.com/docs/sdk) · [`@usetdt/helm-sdk`](https://www.npmjs.com/package/@usetdt/helm-sdk) |
| ThisDamnThing | [usetdt.com](https://usetdt.com) |
| Stacks marketplace | [stacks.usetdt.com](https://stacks.usetdt.com) |
| Issues | [github.com/CharlGottschalk/helm/issues](https://github.com/CharlGottschalk/helm/issues) |
| Developing Helm | [DEVELOPMENT.md](DEVELOPMENT.md) |

## License

Helm (the app and its internal packages) has the
[Functional Source License 1.1, Apache 2.0 Future License](LICENSE.md) (`FSL-1.1-ALv2`).
You can use, change and redistribute Helm for all purposes, except a competing
commercial product. Each release becomes Apache-2.0 two years after its publication.
The plugin SDK (`packages/sdk`, `@usetdt/helm-sdk`) has the
[Apache-2.0](packages/sdk/LICENSE) license. The `tdt-helm` stack in its own
repository also has the Apache-2.0 license.

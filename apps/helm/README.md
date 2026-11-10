# @usetdt/helm

> **Beta.** Helm and its SDK are in beta (0.x). Expect bugs, and changes between versions.
> Report problems in [GitHub issues](https://github.com/CharlGottschalk/helm/issues).

Helm is a local Command Deck for [ThisDamnThing](https://usetdt.com) (TDT) workspaces:
themes, a dashboard of widgets, tabbed tools, a brain graph, agent sessions and a
workspace terminal. It runs a server on `127.0.0.1`, talks to TDT through `tdt mcp serve`,
and hands chat and builds to Claude Code or Codex. Helm never runs a model itself.

## Install

Node 24 or later.

```sh
npm install -g @usetdt/helm
```

On Linux, the workspace terminal needs the node-pty install script, which npm skips in a
global install by default:

```sh
npm install -g @usetdt/helm --allow-scripts=node-pty
```

For live data, install TDT with the MCP extra: `pipx install 'thisdamnthing[mcp]'`.

## Start

Add your workspace to `~/.helm/config.json` (see Configuration in the docs), then run:

```sh
helm
```

Helm prints a local URL with an access token. Open it in your browser.

## Documentation

The user guides and the plugin SDK are at [helm.usetdt.com](https://helm.usetdt.com).
The source is at [github.com/CharlGottschalk/helm](https://github.com/CharlGottschalk/helm).

## License

FSL-1.1-ALv2. See [LICENSE.md](LICENSE.md).

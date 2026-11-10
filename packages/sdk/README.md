# @usetdt/helm-sdk

> **Beta.** Helm and its SDK are in beta (0.x). Expect bugs, and changes between versions.
> Report problems in [GitHub issues](https://github.com/CharlGottschalk/helm/issues).

The SDK for [Helm](https://helm.usetdt.com) plugins: widgets, tools and themes for the Helm
Command Deck of a [ThisDamnThing](https://usetdt.com) workspace. It contains the plugin
contracts, a typed bridge for sandboxed frames, React bindings, the theme tokens and the
`helm-sdk` CLI.

## Make a plugin

Node.js 20 or later.

```sh
npx @usetdt/helm-sdk create widget my-widget     # or: tool, theme; add --react for React
cd my-widget && npm install
npm run build                                     # bundle to dist/ and validate
helm plugin link "$PWD"                           # install it into Helm for review
```

A theme plugin has no build. Run `npm run validate` instead.

## Contents

| Path | Contains |
| --- | --- |
| `docs/` | The contracts: widget, tool, settings, connection, theme, kit, plugin, React |
| `@usetdt/helm-sdk` | Types, validators and the theme tokens |
| `@usetdt/helm-sdk/frame` | The typed `helm` bridge for code in a sandboxed frame |
| `@usetdt/helm-sdk/react` | React hooks and kit components |
| `bin/helm-sdk` | `create`, `build`, `validate` and `dev` |
| `templates/` | The files that `create` copies |

The contracts are also on the web: [helm.usetdt.com/docs/sdk](https://helm.usetdt.com/docs/sdk).

## License

Apache-2.0. See [LICENSE](LICENSE).

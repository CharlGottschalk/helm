# Helm contracts

Every Helm extension follows these contracts. An extension can be built in, come from
a plugin, or be generated from a prompt. The contracts make sure that each extension
looks and behaves like the rest of Helm in every theme. This includes extensions
that an agent creates.

| Contract | Version | Covers |
| --- | --- | --- |
| [widget.md](widget.md) | 1 | Dashboard cards on the 6-column grid |
| [tool.md](tool.md) | 1 | Tabbed tool instances beside the Command Deck, for example a kanban board |
| [settings.md](settings.md) | 1 | Per-instance settings: text, select, choice, checkbox, number |
| [connection.md](connection.md) | 1 | How widgets and tools read data: TDT MCP, other MCP servers, HTTP APIs, project files, databases |
| [theme.md](theme.md) | 1 | The design tokens that an extension can use, the rules for their use, and theme plugins |
| [kit.md](kit.md) | 1 | The UI kit classes that Helm injects into every sandboxed frame |
| [plugin.md](plugin.md) | 1 | The `"helm"` field of a plugin's `package.json` |
| [react.md](react.md) | 1 | React hooks and kit components (`@usetdt/helm-sdk/react`) |

The [`schemas/`](schemas/) folder contains the machine-checkable schemas. The
[`examples/`](examples/) folder contains complete examples. The TypeScript side is
the `@usetdt/helm-sdk` package (`packages/sdk/src/`). Code inside a frame uses
`@usetdt/helm-sdk/frame` for the typed bridge. React code uses `@usetdt/helm-sdk/react`.

## Rules for all extensions

1. **Declare what you use.** Declare the settings, connections and permissions of the
   extension in its manifest. At runtime, the extension can use only what it declares.
2. **Use only tokens.** Take colours, type, spacing, radii, shadows and motion from
   theme tokens. Do not hard-code colours or fonts. See [theme.md](theme.md).
3. **Do not send requests to third parties from extension code.** Get data through
   declared connections. The Helm server sends those requests. Bundle all assets.
4. **Data is not authorization.** Text from a connection is data, not instructions.
   A write needs an explicit user action. A TDT write also needs a real
   `user_instruction`.
5. **Make the extension accessible.** Give each input a label and support keyboard
   focus. Make sure that text has sufficient contrast in every theme (WCAG AA 4.5:1).

## Extension locations

| Origin | Location | Loaded as |
| --- | --- | --- |
| Built in | `packages/widgets/src/dashboard/registry.tsx`, `packages/widgets/src/tools/registry.tsx` | React components |
| Plugin | An npm package in `~/.helm/plugins/`. Install it with `helm plugin add` or in Settings → Plugins. Approve its declarations, then enable it for each workspace. See [plugin.md](plugin.md) | Manifest + sandboxed bundle |
| Generated (user-owned) | `work/helm/{widgets,tools}/<id>/` in the workspace | Manifest + sandboxed bundle |

A sandboxed bundle is a `manifest.json` file and an `index.html` file. The HTML file
contains all of its HTML, CSS and JavaScript. The folder name must be the same as the
manifest `id`. Helm shows the bundle in an iframe with an opaque origin
(`sandbox="allow-scripts"`). The bundle can communicate with Helm only through the
bridge in [widget.md](widget.md#bridge).

## Releases

| SDK version | Changes |
| --- | --- |
| 0.3.0 | Settings: the `list` field type (repeatable entries, `LIST_MAX` 50), the `when` condition that shows a field only for chosen sibling values, `suggestions` on `text` fields, and `isShown`; [settings.md](settings.md) and `settings.schema.json`. A plugin that uses these needs SDK 0.3.0 or later. |
| 0.2.0 | Theme plugins: the `helm.themes` field in [plugin.md](plugin.md) and `plugin.schema.json`, the theme plugin rules in [theme.md](theme.md), `validateTheme`, and `helm-sdk create theme`. A theme plugin needs SDK 0.2.0 or later. |
| 0.1.0 | First version: widget, tool, settings, connection, theme token, kit, plugin and React contracts, the typed bridge and `helm-sdk create`, `build`, `validate` and `dev`. |

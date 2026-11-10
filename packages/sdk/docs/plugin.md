# Plugin package contract v1

A Helm plugin is an npm package that contains one or more sandboxed widgets and tools,
or themes. The `"helm"` field of its `package.json` declares them:

```json
{
  "name": "helm-plugin-example",
  "version": "1.0.0",
  "keywords": ["helm-plugin"],
  "helm": {
    "contract": 1,
    "widgets": ["widgets/workspace-status"],
    "tools": []
  },
  "devDependencies": { "@usetdt/helm-sdk": "^0.2.0" }
}
```

| Field | Rule |
| --- | --- |
| `helm.contract` | `1` (`PLUGIN_CONTRACT`). If Helm does not support the version, it refuses the plugin with a "needs a newer Helm" message. |
| `helm.widgets`, `helm.tools` | Directories relative to the package root. Do not use `..`. List each directory one time. The lists must contain at least one directory in total. |
| `helm.themes` | Theme folders, with the same rules. Each folder has a `manifest.json` file and token files, not a bundle. See [theme.md#theme-plugins](theme.md#theme-plugins). |

Each listed widget or tool directory is a sandboxed bundle, as [README.md](README.md) describes. It
contains a `manifest.json` file ([widget.md](widget.md) or [tool.md](tool.md)) and an
`entry` HTML file that contains all of its code. The folder name must be the same as
the manifest `id`. Add the `helm-plugin` npm keyword so that users can find the plugin.

Machine check: `validatePluginPackage(pkg)` in `@usetdt/helm-sdk`. The schema is
[`schemas/plugin.schema.json`](schemas/plugin.schema.json).

## Write the bundle

- Use only theme tokens and the [UI kit](kit.md) for style. Helm injects both before
  your `<style>` element.
- Communicate with Helm only through the bridge ([widget.md#bridge](widget.md#bridge)).
  For TypeScript, use `import { getHelm, el } from '@usetdt/helm-sdk/frame'`. `getHelm`
  gives the typed bridge. `el` creates elements and inserts text safely.
- Show connection data as text (`textContent` or `el`). Do not show it as HTML.
- Do not use install scripts. Helm installs plugins with `--ignore-scripts`, so the
  package must contain the built bundle.

## Install a plugin

Run these commands in a terminal:

```bash
helm plugin add helm-plugin-example        # npm name or range; also a git URL
helm plugin link ./my-plugin               # a local folder, linked for development
helm plugin list
helm plugin remove helm-plugin-example
```

You can also use Settings → Plugins. Helm installs each plugin one time, into
`~/.helm/plugins/`. That folder has its own `package.json` and lockfile. Helm always
installs with `--ignore-scripts`. Installation does not enable a plugin. To use the
plugin, do these steps:

1. **Review.** Helm shows each widget, tool and theme that the plugin declares. It also
   shows their connections, operations, writes and capabilities, and the contrast
   warnings of each theme.
2. **Approve.** The approval covers only those declarations. Helm records a digest of
   the version, the `"helm"` field, every manifest and every theme token file. An update
   or a changed manifest needs a new approval. Until you approve again, its widgets show an error and do not load.
3. **Enable** the plugin for each workspace. Only enabled, approved plugins appear in
   the library of a workspace. Themes do not need this step: the themes of an approved
   plugin are available in every workspace.

If Helm does not support the `helm.contract` of a plugin, it shows "needs a newer Helm".

## The `helm-sdk` CLI

Run these commands in a terminal:

```bash
npx @usetdt/helm-sdk create widget my-widget   # or: create tool my-tool; add --react for React (react.md)
                                               # or: create theme my-theme (token files only, no build)
cd my-widget
npx helm-sdk build                             # src/<id>/ → dist/<id>/, then validate
npx helm-sdk validate                          # check without building
npx helm-sdk dev                               # build, then rebuild on every change in src/
helm plugin link .                             # once; review and enable in Settings → Plugins
```

`create` makes a package folder. The folder name is the plugin id. The package
contains:

- `package.json`. Its `"helm"` field lists `dist/<id>`.
- `src/<id>/`, with `manifest.json`, `index.html` and `main.js`.

Edit the files in `src/`. The build generates `dist/`. The package must include
`dist/`, because Helm does not run install scripts.

`build` copies each manifest. Then it puts the local `<script src>` and
`<link rel="stylesheet">` files of the entry into one HTML file. It bundles the
scripts, so `import … from '@usetdt/helm-sdk/frame'` works. If a listed directory is
not in `dist/`, `build` does not change it.

`validate` checks the `"helm"` field and every manifest against the contracts. For a
theme it checks the token files and shows contrast warnings ([theme.md](theme.md#theme-plugins)).
It also checks the entry for content that the frame refuses or the contracts forbid:

- Script or stylesheet files.
- Images and CSS `url()` values that are not `data:` URLs.
- Hard-coded colours or fonts in `<style>` and `style=""`.
- `helm.call()` calls (with literal arguments) to connections or operations that the
  manifest does not declare.

If `validate` finds a problem, it exits with a non-zero status.

`dev` builds, validates and rebuilds on every change. It also tells you if Helm is
running and if the plugin is linked. Helm reads the files of a linked plugin directly.
To see a rebuild, reload the widget or tool. A changed manifest needs a new approval.

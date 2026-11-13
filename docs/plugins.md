# Plugins

A plugin adds widgets, tools or themes to Helm. Each plugin is an npm package. Helm
installs a plugin one time, and you enable it for each workspace. Themes do not need
this step: see [Theme plugins](themes.md#theme-plugins).

Helm runs plugin code in a sandboxed frame. A plugin can use only the connections that
it declares, and only after you approve them. To build a plugin, see the
[SDK contracts](../packages/sdk/docs/README.md).

## Install a plugin

Install, approve and enable the plugin. Helm must be running for steps 2 and 3.

1. **Install.** Do one of these steps:
   - In **System settings** → **Plugins**, type the package name or folder in
     **Install**, then click **Install**.
   - In a terminal, run `helm plugin add`. See the commands below.
2. **Review and approve.** Under **Installed**, Helm shows each widget and tool of the
   plugin. For each one, it shows the connections, the calls, the writes and the
   capabilities. Read them. If you agree, click **Approve these declarations**.
3. **Enable.** Turn on **Enabled in {workspace}**. The widgets and tools of the plugin
   then appear in the library of that workspace.

Helm installs plugins with `--ignore-scripts`. It never runs the install scripts of a
plugin.

### Plugin states

| Badge | Meaning |
| --- | --- |
| Needs review | Install or update complete. Approve the declarations before you enable the plugin |
| Approved | You approved the current declarations |
| Needs a newer Helm | The plugin uses a contract version that this Helm does not support |
| Linked | The plugin is a local folder, linked for development |

If a plugin update changes its version or its declarations, the plugin shows
**Needs review** again. Its widgets do not load until you approve it again.

## Plugin commands

Run these commands in a terminal:

```sh
helm plugin add <npm-name | git-url | folder>   # install a plugin (scripts are never run)
helm plugin link <folder>                       # install a local plugin folder for development
helm plugin remove <name>                       # uninstall a plugin
helm plugin list                                # show installed plugins
```

After `add` or `link`, approve and enable the plugin in **System settings** →
**Plugins**.

The `helm` command is on your `PATH` after `npm install -g @usetdt/helm`. If you run
Helm from its source code, run the commands from the repository root as `npx helm …`.

## Uninstall a plugin

Click **Uninstall**, or run `helm plugin remove <name>`. Helm removes the plugin from
every workspace, and it deletes its approval.

## Writes

A plugin can declare writes, for example a change to a file or a request to a service.
Helm asks you to confirm each write in a Helm dialog. The dialog shows the exact
change. Click **Cancel** to refuse it. There is no option to allow all writes.

## The software-production plugin

`@usetdt/helm-plugin-software-production` adds tools for TDT software-production tasks:

- A **Kanban** tool. Move cards between columns, start a build on a ready card, or see
  the handoff of a card in progress. When you move a card into Doing, Helm asks if you
  want only the move, or also a build.
- A **Ready tasks** widget and a **Task pipeline** widget.

It reads internal tasks, and tasks from Linear and GitHub through service profiles
named `linear` and `github`. See [Connections](connections.md).

To install it:

1. Run `helm plugin add @usetdt/helm-plugin-software-production`, or enter that name in
   **System settings** → **Plugins** → **Install**.
2. Approve and enable it in **System settings** → **Plugins**.

The source is at
[github.com/CharlGottschalk/helm-plugin-software-production](https://github.com/CharlGottschalk/helm-plugin-software-production).

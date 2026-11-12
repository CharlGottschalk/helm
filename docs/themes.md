# Themes and appearance

Helm has five built-in themes. Plugins can add more themes ([Theme plugins](#theme-plugins)).
The built-in themes are:

| Theme | Notes |
| --- | --- |
| Holographic HUD | The default theme |
| Aurora Glass | |
| Neon Cyberpunk | |
| Monolith | The rails use a dark variant |
| Satin Slate | The look of TDT |

## Change the theme

1. Open the settings. Click the cog button at the bottom of the left rail, or press
   Ctrl+,.
2. In **System settings**, select **Appearance**.
3. Under **Theme**, click a theme.

Helm applies the theme immediately. Helm keeps your choice in this browser on this
computer.

## Theme plugins

A theme plugin adds one or more themes. A theme plugin has no code. It only sets
colours, fonts, corners and shadows, so it makes no calls and no writes.

1. Install the plugin: in **System settings** → **Plugins**, or with
   `helm plugin add <name>` in a terminal. See [Plugins](plugins.md).
2. Under **Installed**, review the plugin. Helm shows each theme and its contrast
   warnings. Click **Approve these declarations**.
3. In **Appearance** → **Theme**, click the new theme. Its card shows
   **From {plugin}**.

You do not enable a theme for each workspace. An approved theme is available in every
workspace.

If a theme does not meet the WCAG AA contrast level (4.5:1) for its text, Helm still
offers it. Its card and its plugin review show **Below AA contrast**. Some text can be
difficult to read in that theme.

If you remove the plugin, or an update of the plugin is not approved yet, Helm changes
to Holographic HUD. Select the theme again after you approve the update.

To make your own theme, see
[theme.md](../packages/sdk/docs/theme.md#theme-plugins) in the SDK contracts.

## Your name

Under **Your name** in the **Appearance** section, type the name Helm uses for you. It
appears in the sidebar footer, your avatar's initials, the Command deck greeting and
chat. The name stays in this browser and is never sent anywhere. Leave it empty to
use **Operator**.

## Effects

Under **Effects** in the **Appearance** section:

- **Scanlines** shows scan lines on the screen. It is on by default.
- **Reduce motion** turns off view entrances, glitches, pulses and the moving aurora.
  It is off by default.

Helm also reduces motion if your operating system asks for reduced motion.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| / | Go to the chat dock |
| Ctrl+, | Open the settings |
| Alt+1 to Alt+3 | Change the workspace |
| Enter | Send a message, or go to the first brain search result |
| Shift+Enter | Add a new line |
| Esc | Close menus, dialogs and search |
| Middle-click | Close a tab |

**System settings** → **Shortcuts** shows the same list.

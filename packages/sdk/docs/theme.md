# Theme contract v1

Extensions must look native in every Helm theme. The themes are HUD, Aurora Glass,
Neon Cyberpunk, Monolith and Satin Slate, and the themes that plugins add
([Theme plugins](#theme-plugins)). To look native,
an extension uses only the tokens below. The source of truth is
`packages/ui/src/styles/tokens.css` and `packages/ui/src/styles/themes.css`.

## Tokens that extensions can use

| Group | Tokens |
| --- | --- |
| Text | `--c-text-0` (primary) · `--c-text-1` (body) · `--c-text-2` (muted) · `--c-text-3` (faint, labels) · `--c-on-accent` (text on accent fills) |
| Surfaces | `--c-surface` · `--c-surface-raised` · `--c-surface-hover` · `--c-surface-active` · `--c-well` (inputs) · `--c-chrome` (overlays) · `--c-bg-0` |
| Lines | `--c-line` · `--c-line-strong` · `--c-line-hot` · `--c-grid` |
| Accent | `--c-cyan` (primary accent, of any hue) · `--c-cyan-ghost` · `--c-accent-2` (frame accent) · `--c-accent-hover` |
| Signal | `--c-red` / `-ghost` critical · `--c-amber` / `-ghost` attention · `--c-green` / `-ghost` nominal · `--c-violet` / `-ghost` concept · `--c-blue` / `-ghost` document |
| Alpha tints | `rgb(var(--rgb-accent) / α)` and `rgb(var(--rgb-red|amber|green|violet|blue) / α)` |
| Type | `--font-display` · `--font-body` · `--font-mono` · `--fs-2xs` … `--fs-3xl` · `--tracking-hud` · `--tracking-title` · `--display-weight` |
| Space | `--sp-1` (4) … `--sp-10` (40) |
| Shape | `--radius` · `--radius-sm` · `--clip-cut-sm|md|lg` · `--shape-identity` · `--skew` |
| Effects | `--glow-cyan` · `--glow-accent-2` · `--glow-text` · `--shadow-float` · `--blur-panel` |
| Motion | `--dur-fast` (120ms) · `--dur-med` (220ms) · `--dur-slow` (420ms) · `--ease-out` |

Sandboxed extensions receive the resolved values of all of these tokens as CSS
variables on `:root`. Helm sends them again at each theme change. Helm also injects
these global helper classes: `.hud-label`, `.mono` and `.display`.

## Rules

1. **Do not use literal colours, fonts, radii or shadows.** If you need a token that
   is not in the list, propose it for the contract. Do not hard-code a value.
2. **Use signal colours only for meaning.** Red is critical, amber is attention, green
   is nominal or done, violet is concept and blue is document. Do not use them as
   decoration.
3. **Use the accent sparingly.** Each widget body has one primary action, with a
   `--c-cyan` fill.
4. **Keep contrast.** Use `--c-text-0` or `--c-text-1` for body text. Use `--c-text-2`
   and `--c-text-3` only for labels and metadata. All text tokens meet WCAG AA on
   `--c-surface` in every shipped theme. Do not put text on signal fills. The only
   exception is `--c-on-accent` on `--c-cyan`.
5. **Obey the motion settings of the user.** Put non-essential animation in
   `@media (prefers-reduced-motion: no-preference)`. Helm also sets
   `html[data-motion='reduced']`.
6. **Let the theme control glows and shapes.** Use `--glow-*`, `--radius*` and
   `--clip-cut-*`. Do not make your own effects. Satin Slate and Monolith turn glows
   off. Glass makes corners round. Cyberpunk cuts corners.

## Theme plugins

A plugin can add themes. A theme is a set of token values. It has no code, no files
other than its token files, and it makes no calls or writes. Declare theme folders in
`helm.themes` of `package.json` ([plugin.md](plugin.md)):

```json
"helm": { "contract": 1, "themes": ["themes/ember"] }
```

Each theme folder contains a `manifest.json` file and one or two token files. The folder
name must be the same as the manifest `id`. Helm does not build theme folders, so list
them directly (not under `dist/`).

```json
{
  "contract": "helm.theme/1",
  "id": "ember",
  "name": "Ember",
  "tagline": "Warm coal panels, a copper signal and soft corners.",
  "tokens": "tokens.css",
  "chrome": "chrome.css"
}
```

| Field | Rule |
| --- | --- |
| `contract` | `"helm.theme/1"` |
| `id` | Matches `^[a-z][a-z0-9-]{1,63}$` and the folder name |
| `name`, `tagline` | Text, at most 60 and 140 characters |
| `tokens` | A `.css` file in the theme folder, at most 16 KiB |
| `chrome` | Optional. A second token file for the rails (sidebars, tab bar, chat dock). Helm applies it on top of `tokens`, as Monolith does with its dark rails |

A token file contains only `--token: value;` declarations and `/* comments */`. Helm
refuses selectors, braces, at-rules, other properties, `url()`, `var()`, `expression`
and `!important`. A token that you do not set keeps its HUD value. Helm uses the theme
for the shell and sends the resolved tokens to sandboxed widgets and tools, as with
the built-in themes.

### Tokens that a theme can set

| Kind | Tokens | Value |
| --- | --- | --- |
| Hues | `--rgb-accent` · `--rgb-accent-2` · `--rgb-line` · `--rgb-amber` · `--rgb-red` · `--rgb-green` · `--rgb-violet` · `--rgb-blue` · `--rgb-surface` · `--rgb-surface-raised` · `--rgb-chrome` · `--rgb-well` | Three numbers 0–255: `94 234 255` |
| Alpha | `--surface-alpha` · `--raised-alpha` · `--chrome-alpha` · `--well-alpha` · `--bracket-opacity` | A number from 0 to 1 |
| Colours | `--c-void` · `--c-bg-0` · `--c-bg-1` · `--c-bg-2` · `--c-text-0` … `--c-text-3` · `--c-on-accent` · `--c-accent-hover`, and the derived colours `--c-cyan` · `--c-cyan-dim` · `--c-cyan-ghost` · `--c-accent-2` · `--c-{amber,red,green,violet,blue}` and their `-ghost` tokens · `--c-surface` · `--c-surface-raised` · `--c-surface-hover` · `--c-surface-active` · `--c-chrome` · `--c-well` · `--c-line` · `--c-line-strong` · `--c-line-hot` · `--c-grid` | `#rgb`, `#rrggbb` (with optional alpha) or `rgb()` with numbers |
| Fonts | `--font-display` · `--font-body` · `--font-mono` | A font stack of names, such as `'Inter', system-ui, sans-serif`. Use fonts that Helm bundles or system fonts. A theme cannot load font files |
| Lengths | `--radius` · `--radius-sm` · `--cut-sm` · `--cut-md` · `--cut-lg` · `--bracket` · `--tracking-title` | `0` or a number in `px`, `rem` or `em` |
| Angle | `--skew` | A number in `deg` |
| Weight | `--display-weight` | `100` … `900` |
| Shadows | `--glow-cyan` · `--glow-amber` · `--glow-accent-2` · `--glow-text` · `--shadow-float` | `none`, or shadows of lengths, colours and `inset` |
| Blur | `--blur-panel` | `none` or `blur(Npx)`, optionally `saturate(N%)` |

The hues are the primitives: most derived tokens follow from them (see
`packages/ui/src/styles/tokens.css`). Set a derived token only to tune it. Effects
other than tokens are not available to theme plugins: the aurora background, glitches,
scanline variants, background images and custom animations.

### Contrast

`helm-sdk validate` and Helm measure WCAG contrast for these pairs, with unset tokens
at their HUD values: `--c-text-0` … `--c-text-3` on `--c-surface` (over `--c-bg-0`), and
`--c-on-accent` on `--c-cyan`. They also measure the `chrome` tokens. A pair below AA
(4.5:1) is a warning, not an error. Helm still offers the theme, and shows
**Below AA contrast** in the plugin review and in the theme picker.

### Approval and removal

A theme plugin needs review and approval like any plugin. The approval covers the
manifests and the token values. A changed token file needs a new approval. Approved
themes are available in every workspace: there is no per-workspace enable for themes.
If you remove a plugin, or its theme is no longer approved, Helm changes to the default
theme (Holographic HUD).

To start a theme plugin, run `npx @usetdt/helm-sdk create theme my-theme`. The Helm
repository has an example theme plugin with a rail sub-theme, in
`packages/sdk/examples/helm-theme-example`.

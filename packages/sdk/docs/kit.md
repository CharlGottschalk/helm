# UI kit v1

Helm injects these classes into every sandboxed frame, after the theme tokens
([theme.md](theme.md)). Thus plugins match Helm in all five themes, and they do not
need their own CSS. The source is `KIT_CSS` in `@usetdt/helm-sdk`.

| Class | Use |
| --- | --- |
| `h-stack` | Vertical stack with `--sp-2` gaps |
| `h-muted` | Secondary text |
| `h-value` | A number or headline value in the display font |
| `h-state` | Replaces the content for a state that is not ready. Add `h-state--loading` or `h-state--error`. Plain `h-state` is the empty or unconfigured state |
| `h-list` + `h-row` | A list of rows, with the label on the left, the value on the right and a divider between rows. A `button.h-row` is a row that the user can click |
| `h-badge` | Small status label. The tones are `h-badge--cyan`, `--amber`, `--red`, `--green`, `--violet` and `--blue` |
| `h-btn`, `h-btn--ghost` | Primary and secondary buttons |
| `h-field` + `h-input` | A form control with a label (`<label class="h-field">Name <input class="h-input"></label>`) |

React plugins get these classes as components from `@usetdt/helm-sdk/react`
([react.md](react.md)).

The kit also sets `box-sizing: border-box` and a visible `:focus-visible` outline.

Every widget handles five states:

- Unconfigured: `h-state` with an `h-btn` that calls `helm.openSettings()`.
- Loading.
- Empty.
- Error, with a Retry `h-btn--ghost`.
- Ready.

```html
<div id="app" class="h-state h-state--loading">Loading…</div>
<script>
  // ready
  app.className = ''
  app.replaceChildren(list)   // <ul class="h-list"><li class="h-row"><span>Projects</span><b class="h-value">8</b></li></ul>
</script>
```

Badge text uses `--c-text-0` on the ghost colour of the tone. Thus the contrast is
sufficient in every theme. The tone colour is the border. Do not put text in a signal
colour on a ghost background.

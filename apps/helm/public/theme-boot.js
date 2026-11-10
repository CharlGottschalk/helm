// Apply the saved theme before first paint to avoid a flash of the default theme.
// A static file (not inline) so the server's CSP can stay `script-src 'self'`.
try {
  var s = JSON.parse(localStorage.getItem('helm.state.v1') || '{}').settings || {}
  var d = document.documentElement
  d.dataset.theme = s.theme || 'hud'
  d.dataset.scanlines = s.scanlines === false ? 'off' : 'on'
  d.dataset.motion = s.reduceMotion ? 'reduced' : 'full'
} catch (e) {}

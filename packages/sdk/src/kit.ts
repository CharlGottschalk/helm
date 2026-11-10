// UI kit v1 (docs/kit.md): framework-agnostic classes on theme tokens, injected into every
// sandboxed frame after the tokens, so plugins look like Helm in every theme.

export const KIT_CSS = [
  '*,*::before,*::after{box-sizing:border-box}',
  ':focus-visible{outline:2px solid var(--c-cyan);outline-offset:2px}',
  '.h-stack{display:flex;flex-direction:column;gap:var(--sp-2)}',
  '.h-muted{color:var(--c-text-2)}',
  '.h-value{font-family:var(--font-display);font-weight:var(--display-weight);letter-spacing:var(--tracking-title);color:var(--c-text-0)}',
  // states: one at a time, in place of the content
  '.h-state{display:flex;flex-direction:column;align-items:flex-start;gap:var(--sp-2);padding:var(--sp-2) 0;font-size:var(--fs-sm);color:var(--c-text-2)}',
  '.h-state--error{color:var(--c-red)}',
  '.h-state--loading::before{content:"";width:var(--sp-6);height:2px;background:var(--c-cyan);animation:h-pulse var(--dur-slow) var(--ease-out) infinite alternate}',
  '@keyframes h-pulse{from{opacity:.25}to{opacity:1}}',
  '@media (prefers-reduced-motion:reduce){.h-state--loading::before{animation:none}}',
  // lists and rows
  '.h-list{list-style:none;margin:0;padding:0}',
  '.h-row{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-3);padding:var(--sp-2) 0;border-bottom:1px solid var(--c-line)}',
  '.h-row:last-child{border-bottom:0}',
  '.h-row>:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  'button.h-row{width:100%;font:inherit;color:inherit;text-align:left;background:none;border-width:0 0 1px;cursor:pointer}',
  'button.h-row:hover{background:var(--c-surface-hover)}',
  // badges: tone carries meaning, text stays readable
  '.h-badge{display:inline-flex;align-items:center;padding:0 var(--sp-2);border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:var(--tracking-hud);text-transform:uppercase;color:var(--c-text-1);background:var(--c-surface-raised);border:1px solid var(--c-line)}',
  ...['cyan', 'amber', 'red', 'green', 'violet', 'blue'].map((t) => `.h-badge--${t}{color:var(--c-text-0);background:var(--c-${t}-ghost);border-color:var(--c-${t})}`),
  // buttons
  '.h-btn{display:inline-flex;align-items:center;gap:var(--sp-1);font:inherit;font-size:var(--fs-sm);padding:var(--sp-1) var(--sp-3);border:0;border-radius:var(--radius-sm);color:var(--c-on-accent);background:var(--c-cyan);cursor:pointer;transition:background var(--dur-fast) var(--ease-out)}',
  '.h-btn:hover{background:var(--c-accent-hover)}',
  '.h-btn--ghost{color:var(--c-text-1);background:transparent;border:1px solid var(--c-line-strong)}',
  '.h-btn--ghost:hover{background:var(--c-surface-hover)}',
  '.h-btn:disabled{opacity:.5;cursor:not-allowed}',
  // forms
  '.h-field{display:flex;flex-direction:column;gap:var(--sp-1);font-size:var(--fs-sm);color:var(--c-text-2)}',
  '.h-input{font:inherit;font-size:var(--fs-md);color:var(--c-text-0);background:var(--c-well);border:1px solid var(--c-line-strong);border-radius:var(--radius-sm);padding:var(--sp-1) var(--sp-2)}',
].join('')

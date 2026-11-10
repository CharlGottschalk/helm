/** Helm mark: a ship's wheel abstracted into a hex with eight spokes. Strokes follow the theme accent. */
export function Logo({ size = 28 }: { size?: number }) {
  const stroke = { stroke: 'var(--c-cyan)', strokeWidth: 1.4, fill: 'none' }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Helm">
      <path d="M16 2 28 9v14l-12 7L4 23V9Z" style={{ ...stroke, stroke: 'var(--c-accent-2)' }} />
      <circle cx="16" cy="16" r="5.2" style={stroke} />
      <circle cx="16" cy="16" r="1.8" style={{ fill: 'var(--c-cyan)' }} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return (
          <line
            key={i}
            x1={16 + Math.cos(a) * 5.2}
            y1={16 + Math.sin(a) * 5.2}
            x2={16 + Math.cos(a) * 9}
            y2={16 + Math.sin(a) * 9}
            style={{ ...stroke, strokeOpacity: i % 2 ? 0.45 : 1 }}
          />
        )
      })}
    </svg>
  )
}

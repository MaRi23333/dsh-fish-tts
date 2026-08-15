/**
 * Simple geometric speaker glyphs shared by the per-message action button and
 * the composer auto-read toggle. Pure inline SVG, no icon library.
 */

export interface SpeakerIconProps {
  /** Render the muted variant (speaker body + slash). */
  muted?: boolean
  /** Render the two-arc playing variant (waves). */
  playing?: boolean
}

export function SpeakerIcon({ muted = false, playing = false }: SpeakerIconProps): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 6.5v3h2.2L8 12.2V3.8L4.7 6.5H2.5z" fill="currentColor" />
      {muted
        ? (
            <path d="M10.1 6.3l3.5 3.5M13.6 6.3l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          )
        : playing
          ? (
              <>
                <path d="M10.2 6.2a2.6 2.6 0 010 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M11.8 4.6a4.8 4.8 0 010 6.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </>
            )
          : (
              <path d="M10.2 6a2.6 2.6 0 010 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            )}
    </svg>
  )
}

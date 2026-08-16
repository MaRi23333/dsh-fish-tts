/**
 * Speaker glyphs matching the DSH native action-bar icon style.
 *
 * Native icons (copy / thumbs / branch) are 16x16 single-path glyphs whose
 * "outline" is a ~1.35px filled band in currentColor. These speaker glyphs
 * reproduce that weight with stroked outlines (stroke-width 1.35, round
 * joins/caps) which render identically at the fixed 16px size.
 *
 * Variants: default (speaker + one wave), playing (two waves), muted (X).
 * Drop-in replacement for the previous filled-silhouette version
 * (design delivery: fish-tts-branding pack, 2026-08-16).
 */

export interface SpeakerIconProps {
  /** Render the muted variant (speaker body + X). */
  muted?: boolean
  /** Render the two-arc playing variant (waves). */
  playing?: boolean
}

export function SpeakerIcon({ muted = false, playing = false }: SpeakerIconProps): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Speaker body outline — band weight matches native action icons (~1.35px). */}
      <path
        d="M2.6 6.9H5.1L8.2 4V12L5.1 9.1H2.6Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      {muted
        ? (
            <path d="M10.1 6.3l3.5 3.5M13.6 6.3l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          )
        : playing
          ? (
              <>
                <path d="M10.25 6.27A2.2 2.2 0 0 1 10.25 9.73" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M11.36 4.85A4 4 0 0 1 11.36 11.15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </>
            )
          : (
              <path d="M10.25 6.27A2.2 2.2 0 0 1 10.25 9.73" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            )}
    </svg>
  )
}

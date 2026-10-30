// Scoped to this section: the host and other plugins keep their own controls.
export const settingsCss = `
.fish-tts-settings {
  container: fish-tts / inline-size;
  --fish-tts-action-text: color-mix(in srgb, var(--dsw-alias-link, var(--dsw-alias-state-business-primary, #2563eb)) 80%, var(--dsw-alias-label-primary, #111827));
}
.fish-tts-settings button, .fish-tts-settings input, .fish-tts-settings select, .fish-tts-settings textarea {
  transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease, transform 100ms ease;
}
.fish-tts-settings button:not(:disabled):hover {
  border-color: var(--dsw-alias-state-business-primary, #2563eb) !important;
  box-shadow: 0 1px 2px rgba(0,0,0,.06);
}
.fish-tts-settings button:not(:disabled):active { transform: translateY(1px); }
.fish-tts-settings :is(button, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2563eb);
  outline-offset: 3px;
}
.fish-tts-settings :is(input, select, textarea):focus-visible { outline-offset: 1px; }
.fish-tts-settings input::placeholder, .fish-tts-settings textarea::placeholder {
  color: var(--dsw-alias-label-tertiary, #6b7280); opacity: 1;
}
.fish-tts-settings input[type="range"] { appearance: none; height: 20px; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
.fish-tts-settings input[type="range"]:disabled { opacity: .45; cursor: default; }
.fish-tts-settings input[type="range"]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px;
  background: linear-gradient(to right, rgba(37,99,235,.95) 0 var(--fish-range-progress, 0%), var(--dsw-alias-border-l4, rgba(128,128,128,.4)) var(--fish-range-progress, 0%) 100%);
}
.fish-tts-settings input[type="range"]::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; margin-top: -5px; border: 0; border-radius: 50%; background: rgba(37,99,235,.95); }
.fish-tts-settings input[type="range"]::-moz-range-track { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l4, rgba(128,128,128,.4)); }
.fish-tts-settings input[type="range"]::-moz-range-progress { height: 4px; border-radius: 2px; background: rgba(37,99,235,.95); }
.fish-tts-settings input[type="range"]::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: rgba(37,99,235,.95); }
.fish-tts-settings select option { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #111827); }
.fish-tts-settings summary {
  display: flex; align-items: center; gap: 8px; min-height: 24px;
  cursor: pointer; list-style: none; border-radius: 4px;
}
.fish-tts-settings summary::-webkit-details-marker { display: none; }
.fish-tts-settings summary::before {
  content: '›'; flex: 0 0 12px; font-size: 20px; line-height: 1;
  color: var(--dsw-alias-label-secondary, #4b5563); transition: transform 140ms ease;
}
.fish-tts-settings details[open] > summary::before { transform: rotate(90deg); }
.fish-tts-summary-label { flex: 1 1 auto; min-width: 0; }
.fish-tts-summary-state { flex: 0 1 auto; min-width: 0; color: var(--dsw-alias-label-secondary, #4b5563); font-size: 14px; }
.fish-tts-voice-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.fish-tts-id-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.fish-tts-id-controls > input { flex: 1 1 220px; width: auto; }
.fish-tts-id-controls > button { flex-shrink: 0; }
.fish-tts-range-controls { display: flex; align-items: center; gap: 12px; flex: 0 1 240px; min-width: 0; }
.fish-tts-range-controls > input { width: 100%; min-width: 0; }
.fish-tts-range-controls > output { min-width: 42px; flex-shrink: 0; text-align: right; font-variant-numeric: tabular-nums; }
.fish-tts-voice-tools > details[open] { flex-basis: 100% !important; }
.fish-tts-settings .fish-tts-quiet-button { border-color: transparent !important; padding: 2px 0 !important; min-height: 28px !important; }
.fish-tts-settings .fish-tts-quiet-button:not(:disabled) { color: var(--fish-tts-action-text) !important; }
.fish-tts-settings .fish-tts-quiet-button:not(:disabled):hover { box-shadow: none; text-decoration: underline; }
@container fish-tts (max-width: 440px) {
  .fish-tts-id-controls > input { flex-basis: 100%; width: 100%; }
  .fish-tts-range-controls { flex-basis: 100%; }
  .fish-tts-summary-state { margin-left: 20px; }
  .fish-tts-settings summary { flex-wrap: wrap; }
  .fish-tts-summary-label { flex: 1 1 calc(100% - 24px); }
}
@media (prefers-reduced-motion: reduce) {
  .fish-tts-settings *, .fish-tts-settings summary::before { transition: none !important; }
  .fish-tts-settings button:not(:disabled):active { transform: none; }
}
`

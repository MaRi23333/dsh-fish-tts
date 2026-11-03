/** Settings-nav decoration, following the instruction editor and watchdog. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { en, zh } from './locales.ts'

// The settings shell uses a closed icon table; third-party sections get a gear.
// Match our own localized labels and leave every other section untouched.
const NAV_LABELS: ReadonlySet<string> = new Set([
  zh['settings.label'],
  en['settings.label'],
])

// Same speaker outline as SpeakerIcon in the page heading and message actions.
const NAV_ICON_INNER =
  '<path d="M2.6 6.9H5.1L8.2 4V12L5.1 9.1H2.6Z" stroke-linejoin="round"/>'
  + '<path d="M10.25 6.27A2.2 2.2 0 0 1 10.25 9.73" stroke-linecap="round"/>'

export function decorateSettingsNavIcon(ctx: Pick<ClientContext, 'effect'>): void {
  ctx.effect(() => {
    const decorate = (): void => {
      const dialog = document.querySelector('[role="dialog"]')
      if (dialog === null) return
      for (const button of Array.from(dialog.querySelectorAll('button'))) {
        const label = button.querySelector(':scope > span')
        if (label === null || !NAV_LABELS.has(label.textContent ?? '')) continue
        const existing = button.firstElementChild
        if (!(existing instanceof SVGElement) || existing.dataset.navIcon === 'fish-tts') continue
        const template = document.createElement('template')
        template.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true" data-nav-icon="fish-tts">${NAV_ICON_INNER}</svg>`
        existing.replaceWith(template.content.firstElementChild as SVGElement)
      }
    }
    const observer = new MutationObserver(decorate)
    observer.observe(document.body, { childList: true, subtree: true })
    decorate()
    return () => observer.disconnect()
  }, 'fish-tts: settings nav icon')
}

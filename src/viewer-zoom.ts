/**
 * The reading size: a ladder step, or one of the three ways to fit.
 *
 * It lives in the URL and is rendered as a class, so the page is the right size before any script runs.
 *
 * @module c4-view/viewer-zoom
 */
/** The zoom ladder, mirrored in public/viewer.js — a class per step, so `?zoom=` needs no JS. */
export const LADDER = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
/**
 * Two fits, one per axis, and they mean the same thing in any layout:
 * **fit-h** scales so the width fits (a wide drawing shows whole; a tall one scrolls down),
 * **fit-v** scales so the height fits (a tall drawing shows whole; a wide one scrolls across).
 */
export type Fit = 'fit-v' | 'fit-h'
/** `null` is the opening size: whichever of the two fits shows the whole drawing. */
export type Zoom = number | Fit | null

/** The presets a reader can click; real links, so they work with JS off. */
export const ZOOM_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ['fit-v', 'Fit V'],
  ['fit-h', 'Fit H'],
  ['1', '100%'],
]

/** `?zoom=` → a named fit, or the nearest ladder step; absent or nonsense → the opening fit. */
export function zoomOf(raw: string | null): Zoom {
  if (!raw || raw === 'fit' || raw === 'fit-v' || raw === 'fit-h') return raw === 'fit-v' || raw === 'fit-h' ? raw : null
  const wanted = Number(raw)
  if (!Number.isFinite(wanted) || wanted <= 0) return null
  return LADDER.reduce((best, step) => (Math.abs(step - wanted) < Math.abs(best - wanted) ? step : best), LADDER[0])
}

/** The class the stage carries: one name for every zoom, so no two rules can disagree. */
/**
 * The class for a zoom. `null` resolves to a real axis here rather than to a third 'contain' rule: a drawing
 * taller than it is wide opens at fit-v (whole picture), anything else at fit-h.
 */
export function zoomClass(zoom: Zoom, size: { w: number; h: number }): string {
  if (typeof zoom === 'number') return `zoom-${Math.round(zoom * 100)}`
  const fit: Fit = zoom ?? (size.h > size.w ? 'fit-v' : 'fit-h')
  return fit === 'fit-v' ? 'zoom-fit-v' : 'zoom-fit-h'
}

/** `100%`, `125%`, … or the word for the fit mode. */
const FIT_WORD: Record<Fit, string> = { 'fit-v': 'Fit V', 'fit-h': 'Fit H' }

export function sizeOf(zoom: Zoom): string {
  if (typeof zoom === 'number') return `${Math.round(zoom * 100)}%`
  return FIT_WORD[zoom ?? 'fit-v']
}

/** The zoom cluster: presets as real links, then −/+. The readout appears only for a step no preset names. */
export function zoomBar(href: (value: string) => string, zoom: Zoom): string {
  const isOn = (value: string): boolean => {
    if (typeof zoom === 'string') return value === zoom
    return zoom === null ? false : Number(value) === zoom
  }
  const presets = ZOOM_PRESETS.map(([value, text]) => {
    const on = isOn(value)
    return `<a class="c4-zoom-btn" href="${href(value)}" data-zoom="${value}"${on ? ' aria-current="true"' : ''}>${text}</a>`
  })
  const readout = ZOOM_PRESETS.some(([value]) => isOn(value)) ? '' : `<span id="c4-zoom-readout" class="c4-zoom-readout">${sizeOf(zoom)}</span>`
  // Two pills, not one: the fits are options you pick, the stepper is a control you press. In one pill the
  // readout ("Fit V") sat next to the "Fit V" preset and read as a duplicate button.
  return `<div class="c4-seg" role="group" aria-label="Fit">${presets.join('')}</div>` +
    '<div class="c4-seg" role="group" aria-label="Zoom"><button type="button" class="c4-zoom-btn" ' +
    'data-step="-1" aria-label="Zoom out">−</button>' +
    '<button type="button" class="c4-zoom-btn" data-step="1" aria-label="Zoom in">+</button>' +
    `${readout}</div>`
}

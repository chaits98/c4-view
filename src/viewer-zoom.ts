/**
 * The reading size: a ladder step, or one of the three ways to fit.
 *
 * It lives in the URL and is rendered as a class, so the page is the right size before any script runs.
 *
 * @module c4-view/viewer-zoom
 */
/** The zoom ladder, mirrored in public/viewer.js — a class per step, so `?zoom=` needs no JS. */
export const LADDER = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
/** Fit fits the whole drawing; fit-w and fit-h fit one axis, which is what a column or a strip needs. */
export type Fit = 'fit' | 'fit-w' | 'fit-h'
export type Zoom = number | Fit | null

/** The presets a reader can click; real links, so they work with JS off. */
export const ZOOM_PRESETS: ReadonlyArray<readonly [string, string]> = [
  ['fit', 'Fit'],
  ['fit-w', 'Fit W'],
  ['fit-h', 'Fit H'],
  ['1', '100%'],
]

/** `?zoom=` → a named fit, or the nearest ladder step; absent or nonsense → Fit. */
export function zoomOf(raw: string | null): Zoom {
  if (!raw || raw === 'fit') return null
  if (raw === 'fit-w' || raw === 'fit-h') return raw
  const wanted = Number(raw)
  if (!Number.isFinite(wanted) || wanted <= 0) return null
  return LADDER.reduce((best, step) => (Math.abs(step - wanted) < Math.abs(best - wanted) ? step : best), LADDER[0])
}

/** The class the stage carries: one name for every zoom, so no two rules can disagree. */
const FIT_CLASS: Record<Fit, string> = { fit: 'zoom-fit', 'fit-w': 'zoom-fit-w', 'fit-h': 'zoom-fit-h' }

export function zoomClass(zoom: Zoom): string {
  if (typeof zoom === 'number') return `zoom-${Math.round(zoom * 100)}`
  return FIT_CLASS[zoom ?? 'fit']
}

/** `100%`, `125%`, … or the word for the fit mode. */
const FIT_WORD: Record<Fit, string> = { fit: 'Fit', 'fit-w': 'Fit W', 'fit-h': 'Fit H' }

export function sizeOf(zoom: Zoom): string {
  if (typeof zoom === 'number') return `${Math.round(zoom * 100)}%`
  return FIT_WORD[zoom ?? 'fit']
}

/** The zoom cluster: presets as real links, then −/+. The readout appears only for a step no preset names. */
export function zoomBar(href: (value: string) => string, zoom: Zoom): string {
  const isOn = (value: string): boolean => {
    if (typeof zoom === 'string') return value === zoom
    if (zoom === null) return value === 'fit'
    return Number(value) === zoom
  }
  const presets = ZOOM_PRESETS.map(([value, text]) => {
    const on = isOn(value)
    return `<a class="c4-zoom-btn" href="${href(value)}" data-zoom="${value}"${on ? ' aria-current="true"' : ''}>${text}</a>`
  })
  const readout = ZOOM_PRESETS.some(([value]) => isOn(value)) ? '' : `<span id="c4-zoom-readout" class="c4-zoom-readout">${sizeOf(zoom)}</span>`
  return [
    ...presets,
    '<button type="button" class="c4-zoom-btn" data-step="-1" aria-label="Zoom out">−</button>',
    '<button type="button" class="c4-zoom-btn" data-step="1" aria-label="Zoom in">+</button>',
    readout,
  ].join('')
}

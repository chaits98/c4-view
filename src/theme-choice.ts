/**
 * The colour-scheme choice: the OS decides unless the reader picked one.
 *
 * `?theme=light|dark|auto` is the state (shareable, Back-safe, no flash), a cookie remembers it
 * for the next page, and "auto" is the absence of an override — `prefers-color-scheme` then does
 * the work with no attribute at all. Nothing here touches JavaScript.
 *
 * @module c4-view/theme-choice
 */

export type Theme = 'light' | 'dark' | 'auto'

export const THEME_COOKIE = 'c4theme'
const VALID = new Set<Theme>(['light', 'dark', 'auto'])

/** The query parameter wins, then the cookie, then the OS. */
export function themeOf(param: string | null, cookieHeader: string | undefined): Theme {
  for (const candidate of [param, cookieValue(cookieHeader)]) {
    if (candidate && VALID.has(candidate as Theme)) return candidate as Theme
  }
  return 'auto'
}

/** `data-theme` for `<html>`: omitted for auto, so the media query is untouched. */
export const themeAttribute = (theme: Theme): string => (theme === 'auto' ? '' : ` data-theme="${theme}"`)

/** One year, same-origin, no secrets in it. */
export const themeCookie = (theme: Theme): string =>
  `${THEME_COOKIE}=${theme}; Path=/; SameSite=Lax; Max-Age=31536000`

function cookieValue(header: string | undefined): string | null {
  if (!header) return null
  const hit = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${THEME_COOKIE}=`))
  return hit ? hit.slice(THEME_COOKIE.length + 1) : null
}

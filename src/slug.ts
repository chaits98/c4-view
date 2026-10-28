/**
 * One file-safe name per level path — and it must be INJECTIVE.
 *
 * A lossy slug made `a/b` and `a-b` share `out/a-b.png`: two different levels, one cached
 * image, both served identical bytes (an external verifier caught it). `/` becomes `~`,
 * which no level segment may contain (the id rule is [A-Za-z0-9_-]), so the mapping keeps
 * distinct paths distinct.
 *
 * @module c4-view/slug
 */
export function levelSlug(path: string): string {
  if (path === '') return 'root'
  return path
    .split('/')
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || '_')
    .join('~')
}

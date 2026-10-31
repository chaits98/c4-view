/**
 * One file-safe name per level path — and it must be INJECTIVE.
 *
 * A lossy slug made `a/b` and `a-b` share `out/a-b.png`: two different levels, one cached
 * image, both served identical bytes (an external verifier caught it). Ids are
 * `[A-Za-z0-9_-]` and case-sensitive, so the mapping does not lowercase or strip anything:
 * it only joins the segments with `~`, which no id may contain. The root level is `~root`
 * so a child literally named `root` cannot collide with it.
 *
 * @module c4-view/slug
 */
export function levelSlug(path: string): string {
  return path === '' ? '~root' : path.split('/').join('~')
}

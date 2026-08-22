/**
 * The one place a lifecycle id or a copy name comes from (spec 13.17, 2L-B).
 *
 * Deterministic on purpose: no timestamp, no UUID, no randomness. The same
 * song asked for the same id five times answers the same five times, which is
 * what lets "create a song" be a pure function and lets a test assert the
 * whole Song byte for byte. Collision safety comes from *looking*, not from
 * entropy — the allocator is handed every id that exists and walks to the
 * first free one.
 *
 * Ids satisfy the schema's only demand (a non-empty string) and follow the
 * shape the existing songs already use: short, lowercase, hyphenated.
 */

/**
 * The first free id of the form `${prefix}-1`, `${prefix}-2`, …
 *
 * For brand-new things: `nextNumberedId(ids, "track")` on a song that already
 * has `track-1` answers `track-2`. Existing hand-written ids ("gtr",
 * "intro") simply never collide with the numbered form.
 */
export function nextNumberedId(
  existing: Iterable<string>,
  prefix: string,
): string {
  const taken = new Set(existing);
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * `base` itself if free, else `${base}-2`, `${base}-3`, …
 *
 * For ids derived from another id: a duplicate of `gtr` asks for `gtr-copy`
 * and gets exactly that until a second duplicate needs `gtr-copy-2`.
 */
export function dedupeId(existing: Iterable<string>, base: string): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A reader-facing name that collides with nothing: `base`, then `base 2`,
 * `base 3`, … Names are compared exactly — trimming and case are the form's
 * business, deciding uniqueness is this function's.
 */
export function dedupeName(existing: Iterable<string>, base: string): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** What a duplicate is called: "Nakarat kopyası", then "Nakarat kopyası 2". */
export function copyName(existing: Iterable<string>, source: string): string {
  return dedupeName(existing, `${source} kopyası`);
}

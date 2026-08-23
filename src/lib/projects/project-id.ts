/**
 * What a project is called on disk (spec 13.21 §6, 2O-A).
 *
 * A counter, not a clock and not a random number. Three reasons, and each of
 * them has bitten a storage layer somewhere:
 *
 * - **A timestamp is not unique.** Two projects created in the same
 *   millisecond — a duplicate loop, a fast import — collide, and a collision
 *   here means one project's payload written over another's.
 * - **A random id is not reproducible.** The same catalog and the same command
 *   would produce a different id every run, so no test could state what a
 *   create *does*, only that it did something.
 * - **Both leak.** A timestamp says when someone worked; a UUID is a stable
 *   device-scoped token. Neither is anybody's business, and neither belongs in
 *   a key that might end up in a bug report.
 *
 * So the id is `project-<n>` where `n` comes from the catalog's own monotonic
 * counter. Deleting a project does not give its number back: the counter only
 * counts up, so a payload that survives a half-finished delete can never be
 * mistaken for a new project that happens to have taken its name.
 */

/**
 * The only shape an id may have.
 *
 * Anchored and digit-led-nonzero on purpose: this pattern is what stops a
 * catalog from naming a storage key after user text. `project-0`,
 * `project-01`, `project-1 ` and `project-../../x` are all refused.
 */
export const PROJECT_ID_PATTERN = /^project-[1-9][0-9]*$/;

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

/** The number inside an id, or null when it is not one of ours. */
export function projectNumber(id: string): number | null {
  if (!isProjectId(id)) return null;
  const parsed = Number(id.slice("project-".length));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function projectId(n: number): string {
  return `project-${n}`;
}

/**
 * The highest number any of these ids carries, or 0 when there are none.
 *
 * Used to keep a counter honest after a hand-edited or partially recovered
 * catalog: the next number must clear every id that already exists, not just
 * the one the counter happens to remember.
 */
export function highestProjectNumber(ids: readonly string[]): number {
  let highest = 0;
  for (const id of ids) {
    const n = projectNumber(id);
    if (n !== null && n > highest) highest = n;
  }
  return highest;
}

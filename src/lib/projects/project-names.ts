/**
 * What a new project is called before anyone renames it (spec 13.21 §6).
 *
 * There is one name authority and it is `Song.title` — the catalog holds no
 * title of its own. So "naming a project" is choosing a title for its song,
 * and the only thing this module adds is that the choice is *deterministic*:
 * the same library and the same command produce the same name, every run.
 *
 * `Yeni Şarkı`, then `Yeni Şarkı 2`, `Yeni Şarkı 3` — the first free number,
 * so a library that has had projects deleted does not skip. Duplicates get
 * `<name> kopyası`, then `<name> kopyası 2`.
 *
 * Two projects with the same title are allowed. Titles are not identity here;
 * ids are, and an import that happens to bring in a song called the same thing
 * as an open one is not a reason to refuse the import or to rewrite its music.
 */

/** The first name in the series that nothing in `taken` already uses. */
function firstFree(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n <= used.size + 2; n += 1) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // Unreachable for any real library; deterministic rather than clever.
  return `${base} ${used.size + 2}`;
}

export function newProjectTitle(existingTitles: readonly string[]): string {
  return firstFree("Yeni Şarkı", existingTitles);
}

export function duplicateTitle(
  sourceTitle: string,
  existingTitles: readonly string[],
): string {
  return firstFree(`${sourceTitle} kopyası`, existingTitles);
}

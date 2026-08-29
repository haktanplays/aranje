/**
 * Which build is on screen, and whether it is the one being accepted
 * (2U-A handoff §4).
 *
 * ## Why this cannot be a constant
 *
 * The acceptance route exists to be opened on a phone, from a link, days
 * after it was written. The one thing that can silently ruin that is a stale
 * deploy: the reader opens the URL, the page looks right, and they accept a
 * build from last week. A version written by hand into a component cannot
 * catch that — it would say the right thing on the wrong bundle, because it
 * travels *with* the component rather than with the build.
 *
 * So the answer comes from the build itself, injected by `next.config.ts` at
 * build time from Vercel's commit variable or from the local git.
 *
 * ## Why "expected" comes from the link, not from here
 *
 * The commit being accepted is the commit that *contains* this file, so its
 * hash cannot be known while the file is being written. Pinning a constant
 * would mean pinning the previous commit and calling it the current one,
 * which is the same lie in a different place.
 *
 * The link carries it instead: `?sha=<expected>`. The handoff hands over one
 * URL with the exact commit in it, and that URL opened against any other
 * build refuses. With no `sha` the route still runs — it is useful for
 * development — but it says plainly that no version was pinned, and the
 * result block records that rather than implying a verified run.
 */

/** The commit this bundle was built from, or "unknown". */
export const BUILD_SHA: string =
  process.env.NEXT_PUBLIC_ARANJE_BUILD_SHA ?? "unknown";

/** The first seven characters, which is how a commit is spoken about. */
export function shortSha(sha: string): string {
  return sha === "unknown" ? "unknown" : sha.slice(0, 7);
}

export type VersionGate =
  /** No version was pinned. The run is allowed and says so. */
  | { readonly kind: "unpinned"; readonly actual: string }
  /** The build is the one asked for. */
  | { readonly kind: "match"; readonly actual: string }
  /** A different build answered. The run must not start. */
  | {
      readonly kind: "mismatch";
      readonly expected: string;
      readonly actual: string;
      readonly message: string;
    }
  /** The build could not say which commit it came from. */
  | { readonly kind: "unknown"; readonly expected: string; readonly message: string };

/**
 * Compare what was asked for with what answered.
 *
 * Prefixes match, because a link carries a short sha and the build knows the
 * long one; the comparison is one-directional on purpose — a seven-character
 * expectation is satisfied by the full hash that starts with it, and a full
 * expectation is not satisfied by seven characters of something else.
 */
export function versionGate(
  expected: string | null,
  actual: string = BUILD_SHA,
): VersionGate {
  if (expected === null || expected.trim() === "") {
    return { kind: "unpinned", actual };
  }
  const want = expected.trim().toLowerCase();
  if (actual === "unknown") {
    return {
      kind: "unknown",
      expected: want,
      message: `Bu sürüm hangi commit'ten kurulduğunu bilmiyor; beklenen ${shortSha(
        want,
      )} doğrulanamıyor.`,
    };
  }
  const have = actual.toLowerCase();
  const agrees = have.startsWith(want) || want.startsWith(have);
  if (agrees) return { kind: "match", actual };
  return {
    kind: "mismatch",
    expected: want,
    actual,
    message: `Yanlış sürüm: beklenen ${shortSha(want)}, açılan ${shortSha(actual)}`,
  };
}

/** Whether the seven steps may begin at all. */
export function mayStart(gate: VersionGate): boolean {
  return gate.kind === "match" || gate.kind === "unpinned";
}

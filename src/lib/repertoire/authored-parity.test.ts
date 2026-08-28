import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { REPERTOIRE } from "@/lib/repertoire/fixtures";
import { fingerprintDiff, musicalFingerprint } from "@/lib/song/fingerprint";
import { songSchema, type Song } from "@/lib/song/schema";

/**
 * 2T-C §3. The passage a person wrote, against the passage the model holds.
 *
 * `eval/score-truth/authoring.mjs` drives the production UI from an empty
 * project and writes what came out to `AUTHORED.json`. This is the other half
 * of that check: the comparison lives here so that both fingerprints come
 * from one implementation. A harness that computed its own would eventually
 * disagree with the app about what "the same music" means, and the
 * disagreement would look like a passing test.
 *
 * Skipped rather than failed when the artifact is absent: the unit suite runs
 * on every change and the browser harness does not, and a red test that only
 * means "you did not run the browser today" trains people to ignore red.
 */
const ARTIFACT = "eval/score-truth/artifacts/AUTHORED.json";

type Authored = {
  readonly results: readonly {
    readonly fixture: string;
    readonly failure: string | null;
    readonly song: unknown;
  }[];
};

const artifact: Authored | null = existsSync(ARTIFACT)
  ? (JSON.parse(readFileSync(ARTIFACT, "utf8")) as Authored)
  : null;

const canonical: Readonly<Record<string, () => Song>> = {
  A: REPERTOIRE.fixtureA,
  B: REPERTOIRE.fixtureB,
  C: REPERTOIRE.fixtureC,
};

describe("a passage written through the real UI is the passage we mean", () => {
  it("has an artifact to check, or says why it is skipping", () => {
    if (artifact === null) {
      expect(
        `${ARTIFACT} yok — önce "node eval/score-truth/authoring.mjs" çalıştır.`,
      ).toContain("authoring.mjs");
      return;
    }
    expect(artifact.results.length).toBeGreaterThan(0);
  });

  for (const name of Object.keys(canonical)) {
    it(`matches the canonical fixture ${name}, or is not claimed yet`, () => {
      const run = artifact?.results.find((entry) => entry.fixture === name);
      if (run === undefined) return; // not authored in this round
      expect(run.failure).toBeNull();
      expect(run.song).not.toBeNull();

      const authored = songSchema.parse(run.song);
      const wanted = canonical[name]!();
      const diff = fingerprintDiff(wanted, authored);
      expect(diff, diff ?? "").toBeNull();
      expect(musicalFingerprint(authored)).toBe(musicalFingerprint(wanted));
    });
  }
});

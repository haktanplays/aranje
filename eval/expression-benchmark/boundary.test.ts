/**
 * Where the benchmark is allowed to reach, and what it may not change
 * (2P-A §15, §16).
 *
 * The gate this checkpoint is under is simple to state and easy to breach by
 * accident: *nothing here may become the product*. A candidate that quietly
 * became the default, an enum that grew a member, a comparison switch that
 * appeared in a sheet — each of those turns a benchmark into a shipped
 * decision nobody made.
 *
 * Measured on the import graph and the syntax tree, not by searching text.
 * The one exception is the source audit, which is a genuinely textual
 * question about a document.
 */
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { identifiersOf, valueImportsOf } from "@/lib/dev/ast";
import { EXPRESSIVE_ARTICULATIONS, expressionPresets } from "@/lib/audio/expression";
import { articulationSchema } from "@/lib/song/schema";

const BENCHMARK = [
  "eval/expression-benchmark/analysis.ts",
  "eval/expression-benchmark/candidates.ts",
  "eval/expression-benchmark/fixtures.ts",
  "eval/expression-benchmark/render-entry.ts",
  "eval/expression-benchmark/matrix.ts",
];

/** Every production module, so "nobody imports the benchmark" is checkable. */
function productionFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...productionFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("190. the production expression contract is exactly this", () => {
  /*
   * This pin was written in 2P-A to say "the benchmark changed nothing", and
   * it did its job: the contract stood at eleven articulations through that
   * checkpoint and through 2Q, 2R and 2S. It moved once, in 2T-C §9, by a
   * decision written down in the spec — five techniques a guitarist needs
   * that the app could not say at all.
   *
   * So the pin is not deleted, it is re-set: still a list rather than a
   * count, so a swap fails, and still the thing that makes a silent addition
   * impossible. The benchmark's own numbers are pinned separately below and
   * did not move at all.
   */
  it("has exactly these sixteen articulations", () => {
    expect(articulationSchema.options).toEqual([
      "normal",
      "palm_mute",
      "accent",
      "sustain",
      "staccato",
      "vibrato",
      "bend_half",
      "bend_full",
      "slide",
      "hammer_on",
      "pull_off",
      "ghost",
      "dead",
      "tapping",
      "natural_harmonic",
      "pinch_harmonic",
    ]);
  });

  it("plays exactly these thirteen differently", () => {
    expect([...EXPRESSIVE_ARTICULATIONS]).toEqual([
      "accent",
      "palm_mute",
      "vibrato",
      "bend_half",
      "bend_full",
      "slide",
      "hammer_on",
      "pull_off",
      "ghost",
      "dead",
      "tapping",
      "natural_harmonic",
      "pinch_harmonic",
    ]);
  });

  it("answers for every articulation the contract has, in the matrix", () => {
    /*
     * Added while probing 2P-A (§19, probe 35): dropping an articulation from
     * the generated matrix changed the document and broke nothing, which made
     * the matrix a document that could quietly stop being an inventory.
     *
     * The roles table is generated from `articulationSchema.options`, so this
     * asks the document the same question the schema answers — every name has
     * a row, and the count the prose states is the count the schema has.
     */
    const matrix = readFileSync(
      "eval/expression-benchmark/ARTICULATION-MATRIX.md",
      "utf8",
    );
    for (const name of articulationSchema.options) {
      expect(matrix, name).toContain(`| \`${name}\` |`);
    }
    expect(matrix).toContain(
      `Song Contract'taki artikülasyon sayısı: **${articulationSchema.options.length}**`,
    );
  });

  it("keeps the bend and slide numbers this checkpoint measured against", () => {
    /*
     * The benchmark's whole value depends on the baseline being the shipping
     * behaviour. If one of these moved, every "current" render in
     * MEASUREMENTS.json would be a render of something else.
     */
    expect(expressionPresets.bend.halfCents).toBe(100);
    expect(expressionPresets.bend.fullCents).toBe(200);
    expect(expressionPresets.bend.riseFraction).toBe(0.22);
    expect(expressionPresets.bend.releaseFraction).toBe(0.12);
    expect(expressionPresets.slide.msPerSemitone).toBe(45);
    expect(expressionPresets.slide.maxIntervalSemitones).toBe(12);
  });
});

describe("191. no benchmark state can reach the product", () => {
  it("is imported by no production module", () => {
    for (const path of productionFiles()) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.includes("expression-benchmark"), `${path} -> ${specifier}`).toBe(
          false,
        );
        expect(specifier.includes("chord-audio"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.startsWith("eval/"), `${path} -> ${specifier}`).toBe(false);
        expect(specifier.includes("../../eval"), `${path} -> ${specifier}`).toBe(false);
      }
    }
  });

  it("names no candidate the schema would accept as an articulation", () => {
    const options: readonly string[] = articulationSchema.options;
    for (const kind of [
      "bend_release",
      "prebend",
      "prebend_release",
      "shift_slide",
      "legato_slide",
      "slide_in_below",
      "slide_out_up",
    ]) {
      expect(options, kind).not.toContain(kind);
    }
  });

  it("reaches no store, no history, no project file and no fingerprint", () => {
    for (const path of BENCHMARK) {
      for (const specifier of valueImportsOf(path)) {
        for (const banned of [
          "@/lib/song/song-store",
          "@/lib/song/storage",
          "@/lib/song/edit-history",
          "@/lib/project/project-file",
          "@/lib/copilot/fingerprint",
          "@/lib/copilot/pipeline",
        ]) {
          expect(specifier, `${path} -> ${specifier}`).not.toBe(banned);
        }
        expect(specifier.includes("/projects/"), `${path} -> ${specifier}`).toBe(false);
      }
    }
  });

  it("touches no storage and no network of its own", () => {
    for (const path of BENCHMARK) {
      const names = identifiersOf(path);
      for (const banned of ["localStorage", "sessionStorage", "XMLHttpRequest"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });

  it("keeps the candidate models free of randomness and of the clock", () => {
    // Two runs of the same candidate must produce the same audio, or the
    // listening comparison is comparing two different things.
    for (const path of ["eval/expression-benchmark/candidates.ts"]) {
      const names = identifiersOf(path);
      for (const banned of ["Date", "random", "randomUUID", "performance"]) {
        expect(names.has(banned), `${path} uses ${banned}`).toBe(false);
      }
    }
  });
});

describe("192. no external sample and no competitor asset", () => {
  it("fetches nothing from outside this repository", () => {
    for (const path of [...BENCHMARK, "eval/expression-benchmark/measure.mjs"]) {
      const source = readFileSync(path, "utf8");
      /*
       * A genuinely textual question — is there a URL here — so a textual
       * check is the right instrument. Sample URLs are the one thing that
       * would turn an offline benchmark into a download.
       */
      const urls = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
      const allowed = urls.filter(
        (url) => url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost"),
      );
      expect(urls.length - allowed.length, `${path}: ${urls.join(", ")}`).toBe(0);
    }
  });

  it("records that no competitor audio reference was obtained", () => {
    const sources = readFileSync("eval/expression-benchmark/OFFICIAL-SOURCES.md", "utf8");
    expect(sources).toContain("referenceAudioAvailable: false");
    // The stronger claim this run actually has to make: the pages were not
    // even readable, so there is no semantic evidence either.
    expect(sources).toContain("sourceTextAvailable: false");
  });

  it("never calls a candidate reverse engineered", () => {
    for (const path of [
      "eval/expression-benchmark/OFFICIAL-SOURCES.md",
      "eval/expression-benchmark/EXPRESSION-CONTRACT-V2.md",
      "eval/expression-benchmark/ARTICULATION-MATRIX.md",
    ]) {
      const text = readFileSync(path, "utf8").toLowerCase();
      // Allowed only where the document is explaining that the phrase may
      // *not* be used, which is what the sources document does.
      const claims = text.split("\n").filter(
        (line) => line.includes("reverse engineered") && !line.includes("kullanılamaz"),
      );
      expect(claims, path).toEqual([]);
    }
  });
});

describe("193. the composition roots did not grow", () => {
  const lines = (path: string) => {
    const text = readFileSync(path, "utf8");
    return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  };

  it("keeps Workspace at or under the line it started this checkpoint on", () => {
    expect(lines("src/components/workspace/Workspace.tsx")).toBeLessThanOrEqual(379);
  });

  it("keeps ArrangementCanvas at its budget and away from this feature", () => {
    expect(lines("src/components/workspace/ArrangementCanvas.tsx")).toBeLessThanOrEqual(470);
    for (const specifier of valueImportsOf("src/components/workspace/ArrangementCanvas.tsx")) {
      expect(specifier).not.toContain("preview-bank");
      expect(specifier).not.toContain("preset-availability");
    }
  });
});

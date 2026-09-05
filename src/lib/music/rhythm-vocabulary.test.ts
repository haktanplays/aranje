/**
 * Six questions that used to be one word (2V-D.2 §3, §4, §6).
 *
 * "Ritim" stood for the metre, the feel, the grid, the spacing, the note
 * length and the zoom, and the confusion was not academic: it is why
 * "hızlandır" and "yakınlaş" kept being answered by the same control. These
 * tests hold the separation — one label per concept, one owner per concept,
 * and no view control able to claim it changes the music.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  REASSURANCE,
  RHYTHM_CONCEPTS,
  conceptLabel,
  isMusicalEdit,
  rhythmConcept,
} from "@/lib/music/rhythm-vocabulary";

describe("362. six concepts, six names, no synonyms", () => {
  it("names each of the six exactly once", () => {
    expect(RHYTHM_CONCEPTS).toHaveLength(6);
    const labels = RHYTHM_CONCEPTS.map((concept) => concept.label);
    expect(new Set(labels).size).toBe(labels.length);
    const ids = RHYTHM_CONCEPTS.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets grid, metre and note length share a word", () => {
    /*
     * The three that were actually being confused. If any two of them ever
     * resolve to the same string, a reader asked to "change the ritim" has no
     * way to know which of three different edits they are about to make.
     */
    const meter = conceptLabel("meter");
    const grid = conceptLabel("grid");
    const duration = conceptLabel("duration");
    expect(new Set([meter, grid, duration]).size).toBe(3);
    expect(grid).not.toContain(meter);
    expect(duration).not.toContain(grid);
  });

  it("gives every concept a question a person could be asked out loud", () => {
    for (const concept of RHYTHM_CONCEPTS) {
      expect(concept.question, concept.id).toMatch(/\?$/);
      expect(concept.hint.length, concept.id).toBeGreaterThan(0);
      /* And says what it is *not*, which is the half that stops the drift. */
      expect(concept.notThe.length, concept.id).toBeGreaterThan(0);
    }
  });
});

describe("363. zoom is a camera and cannot reach a note", () => {
  it("owns nothing in the song", () => {
    expect(rhythmConcept("zoom").owner).toBe("view");
    expect(isMusicalEdit("zoom")).toBe(false);
  });

  it("marks every other concept as an edit or a reading of one", () => {
    for (const concept of RHYTHM_CONCEPTS) {
      if (concept.id === "zoom") continue;
      expect(isMusicalEdit(concept.id), concept.id).toBe(true);
    }
  });

  it("carries the sentence a denser bar is explained with", () => {
    /* Word for word from the brief, because the promise it makes — the bar
       will look more detailed and will not sound different — is the whole
       reason a reader trusts the control. */
    expect(REASSURANCE.grid).toBe(
      "Bu ölçü daha ayrıntılı görünecek; süresi değişmeyecek.",
    );
    /* And the zoom sentence promises even less, because zoom changes even
       less: not "the duration will not change" but "nothing happens to the
       music at all". */
    expect(REASSURANCE.zoom).toBe("Yalnız görünüm değişiyor; müziğe hiçbir şey olmuyor.");
  });
});

describe("364. one gate answers whether a rhythm fits", () => {
  it("leaves no component deciding for itself", () => {
    /*
     * §6's rule, as a grep rather than as a promise. A component that
     * compared resolutions itself would be a second answer to a question the
     * gate already owns, and the reader would meet it as a button that says
     * yes over an edit that says no.
     */
    const panel = readFileSync(
      "src/components/workspace/shelf/FastSequencePanel.tsx",
      "utf8",
    );
    expect(panel).toContain("rhythmAvailability");
    for (const forbidden of ["STORED_RESOLUTIONS", "LATTICE_RESOLUTIONS"]) {
      expect(panel, forbidden).not.toContain(forbidden);
    }
  });
});

/**
 * The record, and the two things it must never do (2V-C.2 §1, §4, §5).
 *
 * It must not lose a decision the founder gave, and it must not invent one
 * they did not. Both failures look identical from the outside — a table with
 * a word in every row — so they are checked separately and by name.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { chordTake } from "@/lib/listening/chord-take";
import { listeningClips } from "@/lib/listening/clip-plan";
import {
  archivedCard,
  archiveLines,
  FOUNDER_AUTHORITY,
  isArchived,
  VERDICT_LABEL,
} from "@/lib/listening/founder-authority";
import { gestureTakes } from "@/lib/listening/gesture-take";
import {
  ACTIVE_CLIP_IDS,
  activeClips,
  archivedClips,
  isActive,
} from "@/lib/listening/listening-scope";
import { formatListeningResult } from "@/lib/listening/listening-result";
import { sequenceTake } from "@/lib/listening/sequence-take";

const fixture = editorFixture();
const round = listeningClips(
  fixture,
  chordTake(fixture, { rootPitchClass: 4, quality: "minor" }),
  sequenceTake(fixture),
  gestureTakes(fixture),
);

describe("101. the twenty recorded results, exactly as they were given", () => {
  it("holds every card the founder has judged, in order", () => {
    expect(FOUNDER_AUTHORITY.map((card) => card.id)).toEqual([
      "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8",
      "L9", "L10", "L11", "L12", "L13", "L14", "L15", "L16",
      "L17", "L18", "L19", "L20",
    ]);
  });

  it("keeps the passes that were given", () => {
    for (const id of [
      "L1", "L2", "L3", "L6", "L8", "L9", "L10", "L15", "L16", "L17", "L18",
    ]) {
      expect(archivedCard(id)?.verdict).toBe("pass");
    }
  });

  it("keeps the two conditional passes as conditional, with their debt", () => {
    for (const id of ["L5", "L7"]) {
      expect(archivedCard(id)?.verdict).toBe("conditional_pass");
      expect(archivedCard(id)?.note).toBe("Cila borcu.");
    }
  });

  it("keeps the two slide cards conditional rather than promoting them", () => {
    /* 2V-C.3 polishes what these two were conditional on. Polishing a thing
       is not the founder saying it is done, and the record must not start
       saying so on the strength of a fix. */
    for (const id of ["L19", "L20"]) {
      expect(archivedCard(id)?.verdict).toBe("conditional_pass");
    }
  });

  it("gives L19 the founder's own sentence and L20 no sentence at all", () => {
    expect(archivedCard("L19")?.note).toBe("Vurarak biraz kusurlu duruyor.");
    /*
     * L20 came back conditional and said nothing else. Its card had asked
     * about entering *and* leaving at once, so there is no way to know which
     * half the reservation was about — and a note here would be a guess in
     * the founder's voice. The silence is the record.
     */
    expect(archivedCard("L20")?.note).toBeUndefined();
  });

  it("keeps L4 inconclusive and says it does not block", () => {
    expect(archivedCard("L4")?.verdict).toBe("inconclusive");
    expect(archivedCard("L4")?.note).toContain("bloke etmez");
  });

  it("records the two that were never answered as never answered", () => {
    /* Not a failure and not a pass. A card nobody heard is a card nobody
       heard, and that is the whole of what is written down. */
    expect(archivedCard("L12")?.verdict).toBe("unmeasured");
    expect(archivedCard("L13")?.verdict).toBe("unmeasured");
  });

  it("does not invent a verdict for L14, and keeps the founder's sentence", () => {
    /*
     * No formal verdict was given for L14; what exists is an actionable
     * sentence. Calling it a conditional pass would be inventing a decision.
     */
    const card = archivedCard("L14");
    expect(card?.verdict).toBe("needs_polish");
    expect(card?.note).toBe("Bu biraz daha iyileştirilmeli.");
    expect(card?.verdict).not.toBe("pass");
    expect(card?.verdict).not.toBe("conditional_pass");
  });

  it("carries L11's own words about what was not satisfying", () => {
    expect(archivedCard("L11")?.verdict).toBe("needs_polish");
    expect(archivedCard("L11")?.note).toBe("Geri indir tam tatmin etmedi.");
  });

  it("gives every verdict a word a reader knows", () => {
    for (const card of FOUNDER_AUTHORITY) {
      const label = VERDICT_LABEL[card.verdict];
      expect(label).toMatch(/\S/u);
      expect(label).not.toMatch(/_/u);
    }
  });

  it("is not written by anything at runtime", () => {
    /* A route that could store into the archive would be a second authority
       for the same fact. The registry is a constant and stays one. */
    const source = readFileSync("src/lib/listening/founder-authority.ts", "utf8");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/u);
    expect(source).not.toMatch(/\bpush\(|\bsplice\(/u);
  });
});

describe("102. this round asks four cards, and counts four", () => {
  it("names exactly the four revisions", () => {
    expect([...ACTIVE_CLIP_IDS]).toEqual(["L21", "L22", "L23", "L24"]);
  });

  it("puts the older cards out of the round and into the record", () => {
    for (const id of ["L1", "L10", "L11", "L14", "L16"]) {
      expect(isArchived(id)).toBe(true);
      expect(isActive(id)).toBe(false);
    }
  });

  it("offers only the four in front of the reader", () => {
    expect(activeClips(round).map((clip) => clip.id)).toEqual([
      "L21",
      "L22",
      "L23",
      "L24",
    ]);
  });

  it("keeps the older clips reachable but out of the count", () => {
    const archived = archivedClips(round).map((clip) => clip.id);
    expect(archived.length).toBeGreaterThan(0);
    for (const id of archived) expect(isActive(id)).toBe(false);
  });

  it("counts this round out of four, never out of twenty", () => {
    const block = formatListeningResult({
      buildSha: "abc1234",
      fingerprint: "x",
      clips: round,
      answers: {},
      notes: {},
      note: "",
    });
    expect(block).toContain("Cevaplanmamış: 4/4");
    /*
     * The defect this replaces: a summary that counted this browser
     * session's answers against every card ever built and reported the
     * founder's own decided results as unmeasured.
     */
    expect(block).not.toMatch(/Cevaplanmamış: \d+\/1[0-9]/u);
  });
});

describe("103. one title, and it is the card's own", () => {
  it("never prints a card's id where its name belongs", () => {
    const block = formatListeningResult({
      buildSha: "abc1234",
      fingerprint: "x",
      clips: round,
      answers: {},
      notes: {},
      note: "",
    });
    for (const clip of round) {
      expect(block).not.toContain(`${clip.id} ${clip.id}`);
    }
    for (const card of FOUNDER_AUTHORITY) {
      expect(block).not.toContain(`${card.id} ${card.id}`);
    }
  });

  it("has no second table of names to fall out of", () => {
    /*
     * "L11 L11" came from a hardcoded short-label map that only covered
     * L1–L10; every newer card fell through to its own id. There is one
     * title now and it lives on the card.
     */
    const source = readFileSync("src/lib/listening/listening-result.ts", "utf8");
    expect(source).not.toMatch(/const SHORT/u);
    expect(source).toContain("clip.label");
  });

  it("gives every archived card a descriptive title", () => {
    for (const card of FOUNDER_AUTHORITY) {
      expect(card.title).not.toBe(card.id);
      expect(card.title.length).toBeGreaterThan(3);
      expect(card.title).not.toMatch(/^L\d/u);
    }
  });

  it("prints the archive with those titles and those verdicts", () => {
    const lines = archiveLines();
    expect(lines).toHaveLength(FOUNDER_AUTHORITY.length);
    expect(lines[10]).toBe("L11 Bend: tut / geri indir: Cila gerekiyor — Geri indir tam tatmin etmedi.");
    expect(lines[11]).toBe("L12 Önceden bükme: tut / geri indir: Ölçülmedi");
  });
});

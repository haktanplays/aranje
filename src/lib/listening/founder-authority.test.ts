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

describe("101. the twenty-nine recorded results, exactly as they were given", () => {
  it("holds every card the founder has judged, in order", () => {
    expect(FOUNDER_AUTHORITY.map((card) => card.id)).toEqual([
      "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8",
      "L9", "L10", "L11", "L12", "L13", "L14", "L15", "L16",
      "L17", "L18", "L19", "L20", "L21", "L22", "L23", "L24",
      "L25", "L26", "L27", "L28", "L29",
    ]);
  });

  it("records the three cards that closed the multi-axis phase", () => {
    /*
     * L27 was the pack's only parity card, and the founder answered it in one
     * word. It is stored verbatim: a note rewritten into fuller prose would be
     * this file speaking in their voice.
     */
    expect(archivedCard("L27")?.verdict).toBe("pass");
    expect(archivedCard("L27")?.note).toBe("Aynı");
    /* Passed with nothing said. A decided card with no comment is not the
       same fact as a card nobody played, which is what L12 and L13 are. */
    expect(archivedCard("L28")?.verdict).toBe("pass");
    expect(archivedCard("L28")?.note).toBeUndefined();
    expect(archivedCard("L29")?.verdict).toBe("pass");
    expect(archivedCard("L29")?.note).toBeUndefined();
  });

  it("lets no card of this round rewrite a card of an older one", () => {
    /*
     * The rule L25 established, now with three more cards standing on it: a
     * later pass is a later pass. L19's and L23's polish debts and L7's stay
     * exactly where the founder left them, and the two cards that were never
     * played stay unmeasured rather than being swept up by a tidy round.
     */
    expect(archivedCard("L19")?.verdict).toBe("conditional_pass");
    expect(archivedCard("L23")?.verdict).toBe("conditional_pass");
    expect(archivedCard("L7")?.verdict).toBe("conditional_pass");
    expect(archivedCard("L21")?.verdict).toBe("inconclusive");
    expect(archivedCard("L24")?.verdict).toBe("inconclusive");
    expect(archivedCard("L12")?.verdict).toBe("unmeasured");
    expect(archivedCard("L13")?.verdict).toBe("unmeasured");
  });

  it("records the two cards that closed the slide phase", () => {
    /* L25 and L26 are the gestures L21 and L24 asked about, after the handoff
       was rebuilt on rendered PCM. Both clean, and the seam is closed for
       this engine. */
    expect(archivedCard("L25")?.verdict).toBe("pass");
    expect(archivedCard("L26")?.verdict).toBe("pass");
  });

  it("does not let a later pass rewrite the card it came from", () => {
    /*
     * L25 passing is not the founder revisiting L21. Rewriting the older row
     * to agree with the newer one would delete the only record of what was
     * wrong — and the description in it is what the fix was built from.
     */
    expect(archivedCard("L21")?.verdict).toBe("inconclusive");
    expect(archivedCard("L24")?.verdict).toBe("inconclusive");
    expect(archivedCard("L21")?.note).toMatch(/boşluk/u);
  });

  it("keeps L21 and L24 inconclusive rather than reading a verdict into them", () => {
    /*
     * Both came back "emin değilim" with a description of a defect. That is
     * a lead and not a decision: read as a pass it closes a card the founder
     * did not close, and read as a fail it records a judgement they did not
     * make. 2V-C.4 exists because of the sentence, not because of a verdict.
     */
    for (const id of ["L21", "L24"]) {
      expect(archivedCard(id)?.verdict).toBe("inconclusive");
      expect(archivedCard(id)?.verdict).not.toBe("pass");
      expect(archivedCard(id)?.verdict).not.toBe("needs_polish");
    }
    expect(archivedCard("L21")?.note).toBe(
      "Vurarak da iki ses arasında minik bir boşluk var sanki o bozuyor.",
    );
    expect(archivedCard("L24")?.note).toBe("21'in aynısı.");
  });

  it("records the two slide cards the round did answer", () => {
    expect(archivedCard("L22")?.verdict).toBe("pass");
    expect(archivedCard("L22")?.note).toBeUndefined();
    expect(archivedCard("L23")?.verdict).toBe("conditional_pass");
    expect(archivedCard("L23")?.note).toBe(
      "Kabul edebilirim, gelişmesi gerekebilir ileride ne kadar geliştirilebilirse ondan da emin değilim.",
    );
  });

  it("never turns a card that was measured into one that was not", () => {
    /*
     * Two rows are recorded as unmeasured, and legitimately: L12 and L13
     * were built and never listened to. Every other row carries a decision,
     * and a later round must not quietly demote one of them to "ölçülmedi"
     * — which is what happens when a card is rebuilt and its history is
     * rebuilt with it.
     */
    for (const card of FOUNDER_AUTHORITY) {
      if (card.id === "L12" || card.id === "L13") {
        expect(card.verdict).toBe("unmeasured");
        continue;
      }
      expect(card.verdict, card.id).not.toBe("unmeasured");
    }
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

describe("102. the round that is open, and what it may not re-ask", () => {
  it("asks nothing, because every card has an answer", () => {
    /*
     * L25 and L26 closed the slide phase and the round stood empty while
     * 2V-D.1 built the multi-axis model underneath the cards that come next.
     * These are those cards: a palm-mute parity question, a harmonic under a
     * bend, and a region over one string of two. There is no picking card —
     * the two strokes are identical in the speakers, so asking would be the
     * pack inviting an answer to a difference that is not there.
     */
    expect([...ACTIVE_CLIP_IDS]).toEqual([]);
  });

  it("never asks a card whose answer is already recorded", () => {
    /* A round that re-asks a decided card invites a second answer to a
       closed question, and then there are two records of one fact. */
    for (const id of ACTIVE_CLIP_IDS) expect(isArchived(id)).toBe(false);
  });

  it("puts every judged card out of the round and into the record", () => {
    for (const id of ["L1", "L10", "L11", "L14", "L16", "L21", "L24", "L25", "L26"]) {
      expect(isArchived(id)).toBe(true);
      expect(isActive(id)).toBe(false);
    }
  });

  it("offers nothing in front of the reader between rounds", () => {
    expect(activeClips(round)).toEqual([]);
  });

  it("keeps the older clips reachable but out of the count", () => {
    const archived = archivedClips(round).map((clip) => clip.id);
    expect(archived.length).toBeGreaterThan(0);
    for (const id of archived) expect(isActive(id)).toBe(false);
  });

  it("counts a closed round as nothing to answer, never as the archive", () => {
    const block = formatListeningResult({
      buildSha: "abc1234",
      fingerprint: "x",
      clips: round,
      answers: {},
      notes: {},
      note: "",
    });
    expect(block).toContain("Cevaplanmamış: 0/0");
    /*
     * The defect this replaces: a summary that counted this browser
     * session's answers against every card ever built and reported the
     * founder's own decided results as unmeasured.
     */
    expect(block).not.toMatch(/Cevaplanmamış: \d+\/(1[0-9]|2[0-9])/u);
  });

  it("keeps every built card reachable in the archive", () => {
    /* A closed round hides nothing: the cards are still there, still
       playable, and answered. */
    const archived = archivedClips(round).map((clip) => clip.id);
    for (const id of ["L25", "L26"]) expect(archived).toContain(id);
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

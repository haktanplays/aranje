/**
 * What the page draws and what the screen reader says (2V-C.1 §11, §12).
 *
 * The two have to be describing the same gesture, so they come from one
 * function and are checked together. And the sentence has to be one a
 * guitarist could act on without knowing the model: no cents, no enum id, no
 * slot, no error code.
 */
import { describe, expect, it } from "vitest";

import {
  bendAmountLabel,
  connectionReading,
  noteGestureSentence,
  pitchReading,
  readNoteGesture,
} from "@/lib/music/gesture-language";
import { resolveExpression } from "@/lib/music/expression-resolver";

const read = (note: Parameters<typeof readNoteGesture>[0]) => readNoteGesture(note);

describe("94. the four bends are four different marks and four sentences", () => {
  const cases = [
    { kind: "bend", mark: "b1", says: "yukarıda tut" },
    { kind: "bend_release", mark: "br1", says: "geri indir" },
    { kind: "prebend", mark: "pb1", says: "önceden" },
    { kind: "prebend_release", mark: "pbr1", says: "indir" },
  ] as const;

  it("draws a different character for each", () => {
    const marks = cases.map(
      (entry) =>
        read({ pitchGesture: { kind: entry.kind, targetCents: 200 } }).pitch.mark,
    );
    expect(marks).toEqual(cases.map((entry) => entry.mark));
    expect(new Set(marks).size).toBe(cases.length);
  });

  it("says a different thing for each", () => {
    for (const entry of cases) {
      const spoken = read({
        pitchGesture: { kind: entry.kind, targetCents: 200 },
      }).pitch.spoken;
      expect(spoken).toContain(entry.says);
    }
    const spoken = cases.map(
      (entry) =>
        read({ pitchGesture: { kind: entry.kind, targetCents: 200 } }).pitch.spoken,
    );
    expect(new Set(spoken).size).toBe(cases.length);
  });

  it("says how far in a musician's words, never in cents", () => {
    expect(bendAmountLabel(100)).toBe("yarım");
    expect(bendAmountLabel(200)).toBe("tam");
    expect(bendAmountLabel(50)).toBe("çeyrek");
    for (const cents of [50, 100, 200, 300, 400]) {
      expect(bendAmountLabel(cents)).not.toMatch(/\d{2,}/u);
    }
  });

  it("marks a half bend and a full bend differently", () => {
    expect(read({ pitchGesture: { kind: "bend", targetCents: 100 } }).pitch.mark).toBe(
      "b½",
    );
    expect(read({ pitchGesture: { kind: "bend", targetCents: 200 } }).pitch.mark).toBe(
      "b1",
    );
  });

  it("adds vibrato to the top without becoming a different gesture", () => {
    const shaken = read({
      pitchGesture: {
        kind: "bend",
        targetCents: 200,
        vibrato: { startAfterTarget: true, depthCents: 20, rateHz: 5 },
      },
    }).pitch;
    expect(shaken.mark).toBe("b1~");
    expect(shaken.spoken).toContain("yukarıda tut");
    expect(shaken.spoken).toContain("tepede vibrato");
  });
});

describe("95. the two slides read differently on the page", () => {
  it("marks the shift slide as the one that is struck again", () => {
    const legato = connectionReading(
      resolveExpression({ connection: { kind: "legato_slide" } }).connection,
      true,
    );
    const shift = connectionReading(
      resolveExpression({ connection: { kind: "shift_slide" } }).connection,
      true,
    );
    expect(legato.mark).toBe("/");
    expect(shift.mark).toBe("s/");
    expect(legato.spoken).toContain("bağlı");
    expect(shift.spoken).toContain("yeniden vur");
  });

  it("leans the way the music goes, both ways", () => {
    const down = connectionReading(
      resolveExpression({ connection: { kind: "legato_slide" } }).connection,
      false,
    );
    expect(down.mark).toBe("\\");
  });

  it("reads the legacy slide as the legato one it has always been", () => {
    const legacy = connectionReading(
      resolveExpression({ articulation: "slide" }).connection,
      true,
    );
    expect(legacy.mark).toBe("/");
    expect(legacy.spoken).toContain("bağlı");
  });

  it("draws slide-in and slide-out with only one real fret between them", () => {
    const inBelow = pitchReading(
      resolveExpression({ pitchGesture: { kind: "slide_in", from: "below" } }).pitch,
    );
    const outDown = pitchReading(
      resolveExpression({ pitchGesture: { kind: "slide_out", to: "down" } }).pitch,
    );
    expect(inBelow.spoken).toBe("aşağıdan kayarak gir");
    expect(outDown.spoken).toBe("aşağı kayarak çık");
    expect(inBelow.mark).not.toBe(outDown.mark);
  });
});

describe("96. the sentence is the movement, never the model", () => {
  const sentences = [
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({ pitchGesture: { kind: "bend", targetCents: 200 } }),
    }),
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({
        pitchGesture: { kind: "bend_release", targetCents: 200 },
      }),
    }),
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({
        pitchGesture: { kind: "prebend_release", targetCents: 200 },
      }),
    }),
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({ connection: { kind: "legato_slide" } }),
      rising: true,
    }),
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({ connection: { kind: "shift_slide" } }),
      rising: true,
    }),
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({ pitchGesture: { kind: "slide_in", from: "below" } }),
    }),
    noteGestureSentence({
      fret: 17,
      reading: resolveExpression({ pitchGesture: { kind: "slide_out", to: "down" } }),
    }),
  ];

  it("names the fret first, because that is what a guitarist looks for", () => {
    for (const sentence of sentences) {
      expect(sentence.startsWith("17. perde")).toBe(true);
    }
  });

  it("says seven different things", () => {
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("carries nothing internal", () => {
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(
        /slot|tick|cent|pitchGesture|connection|shift_slide|legato_slide|undefined|null/u,
      );
      /* The only digits a reader should meet here are the fret. */
      expect(sentence.replace("17", "")).not.toMatch(/\d/u);
    }
  });

  it("says the fret alone for a note that does nothing special", () => {
    expect(noteGestureSentence({ fret: 5, reading: resolveExpression({}) })).toBe(
      "5. perde",
    );
  });

  it("reads both axes of one note together", () => {
    const both = read({
      connection: { kind: "shift_slide" },
      pitchGesture: { kind: "bend", targetCents: 100 },
    });
    expect(both.connection.mark).toBe("s/");
    expect(both.pitch.mark).toBe("b½");
  });
});

/**
 * How long a note rings, in the bar's own beat (2V-D.2 §7, §8).
 *
 * The test that matters most is the 6/8 one: it is the case where every
 * hardcoded "1/4 = 1 vuruş" in the industry is simply wrong, and where a
 * label derived from the metre says the true thing without being told.
 */
import { describe, expect, it } from "vitest";

import { PPQ } from "@/lib/music/timing";
import {
  RING_QUESTIONS,
  mainBeatTicks,
  ringOptions,
  ringQuestion,
  ringReading,
} from "@/lib/music/ring-language";

const labels = (options: readonly { label: string; value: string | null }[]) =>
  options.map((option) => `${option.label} — ${option.value ?? "—"}`);

describe("365. the beat is the bar's, not the file's", () => {
  it("calls one beat a quarter in 4/4", () => {
    expect(mainBeatTicks({ meter: [4, 4], resolution: 16 })).toBe(PPQ);
    expect(labels(ringOptions({ meter: [4, 4], resolution: 16 }))).toContain(
      "Bir ana vuruş — dörtlük",
    );
  });

  it("calls one beat a dotted quarter in 6/8, which is the whole point", () => {
    /*
     * The brief's own example. A 6/8 beat is three eighths — 288 ticks — and
     * anything that answered "dörtlük" here would be telling a reader their
     * beat is shorter than it is. Nothing in `ring-language.ts` contains the
     * word "noktalı"; it comes out of the note-value vocabulary because the
     * length asked for really is a dotted quarter.
     */
    expect(mainBeatTicks({ meter: [6, 8], resolution: 16 })).toBe(PPQ * 1.5);
    expect(labels(ringOptions({ meter: [6, 8], resolution: 16 }))).toContain(
      "Bir ana vuruş — noktalı dörtlük",
    );
  });

  it("takes the first beat in a metre whose beats differ", () => {
    /* 7/8 felt 2+2+3: the beats are two, two and three eighths. "One beat"
       on a picker has to mean something a reader can point at, and the first
       is the one they count from. */
    expect(mainBeatTicks({ meter: [7, 8], resolution: 16, grouping: [2, 2, 3] })).toBe(PPQ);
    expect(mainBeatTicks({ meter: [7, 8], resolution: 16, grouping: [3, 2, 2] })).toBe(
      PPQ * 1.5,
    );
  });

  it("names a length only when it has a name", () => {
    /* Five sixteenths is real, playable and has no single written value.
       A second line reading "beşlik" would be an invention. */
    expect(ringReading(PPQ, { meter: [4, 4], resolution: 16 })).toEqual({
      label: "Bir ana vuruş",
      value: "dörtlük",
    });
    expect(ringReading(PPQ * 1.25, { meter: [4, 4], resolution: 16 }).value).toBeNull();
  });

  it("offers only lengths that land on whole ticks", () => {
    /* A third of a beat is offered in 4/4 (64 ticks) and not in a metre
       where it would not be an integer. Nothing is rounded into existence. */
    for (const meter of [[4, 4], [3, 4], [6, 8], [7, 8], [5, 8]] as const) {
      for (const option of ringOptions({ meter, resolution: 16 })) {
        expect(Number.isInteger(option.ticks), `${meter[0]}/${meter[1]}`).toBe(true);
        expect(option.ticks).toBeGreaterThan(0);
      }
    }
  });

  it("never puts a fraction on the first line", () => {
    /* The first line is what a player says out loud. "1/4" belongs on the
       second line or nowhere. */
    for (const meter of [[4, 4], [6, 8], [7, 8]] as const) {
      for (const option of ringOptions({ meter, resolution: 16 })) {
        expect(option.label, option.id).not.toMatch(/\d\s*\/\s*\d/);
      }
    }
  });
});

describe("366. three questions, three rows", () => {
  it("asks how long it rings as the one question a beginner meets", () => {
    expect(ringQuestion("ring").question).toBe("Ne kadar çınlasın?");
    expect(ringQuestion("ring").primary).toBe(true);
  });

  it("keeps the next note's timing a separate, advanced question", () => {
    /* §8: duration and onset spacing are two questions. By default the next
       onset follows the duration, so a reader who never opens this never has
       to know it exists. */
    const spacing = ringQuestion("spacing");
    expect(spacing.question).toBe("Sonraki nota ne zaman gelsin?");
    expect(spacing.primary).toBe(false);
    expect(spacing.hint).toContain("isteğe bağlı");
  });

  it("keeps every technique out of the ring picker", () => {
    /*
     * The misreading this split exists to prevent: "Slide · 1/4" read as
     * "slide over four beats". Hammer-on, pull-off, legato and shift slides,
     * bend and vibrato are a *connection*, and the ring options never name
     * one of them.
     */
    const forbidden = [
      /hammer/i,
      /pull/i,
      /slide/i,
      /kaydır/i,
      /bük/i,
      /bend/i,
      /vibrato/i,
      /bağla/i,
    ];
    for (const meter of [[4, 4], [6, 8], [7, 8]] as const) {
      for (const option of ringOptions({ meter, resolution: 16 })) {
        for (const pattern of forbidden) {
          expect(option.label, option.id).not.toMatch(pattern);
          expect(option.value ?? "", option.id).not.toMatch(pattern);
        }
      }
    }
    /* And they have a row of their own, which says so. */
    expect(ringQuestion("connection").hint).toContain("Süreyle ilgisi yok");
  });

  it("lists exactly three, so nothing can be folded into one control", () => {
    expect(RING_QUESTIONS).toHaveLength(3);
    expect(RING_QUESTIONS.filter((question) => question.primary)).toHaveLength(1);
  });
});

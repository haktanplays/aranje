/**
 * Writing the axes separately, and refusing to say one thing twice
 * (2V-D.1 §7, §14).
 *
 * Two questions run through all of it. Does editing one axis leave the others
 * exactly as they were — because "add an accent" must not become "rewrite
 * this note" — and does a span reach only the notes a reader would point at?
 * A span that reaches one note too far is a lost edit nobody sees until they
 * play it.
 */
import { describe, expect, it } from "vitest";

import { resolveExpression } from "@/lib/music/expression-resolver";
import {
  applyAttackWrite,
  applyPickingWrite,
  applySpanRemove,
  applySpanWrite,
} from "@/lib/song/technique-write";
import { pitchAt } from "@/lib/song/edit";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const SECTION = SAMPLE_SONG.sections[0]!.id;

const at = (stringIndex: number, fret: number, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, stringIndex, fret)!,
    position: { string: stringIndex, fret },
    ...extra,
  }) as NoteEvent;

function build(lane: MelodicSlot[], spans?: TechniqueSpan[]): Song {
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        ...(spans ? { techniqueSpans: spans } : {}),
      },
    ],
  } satisfies Song);
}

/**
 * Low string and top string struck together, twice.
 *
 * Both voices carry whatever `extra` says, so a span drawn over the low
 * strings has a note on the *other* string to leave alone — which is the only
 * way a scoping test can fail when scoping breaks.
 */
function twoStrings(extra: Partial<NoteEvent> = {}): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [at(5, 3, extra), at(1, 3, extra)] };
  lane[2] = { notes: [at(5, 5, extra), at(1, 5, extra)] };
  return build(lane);
}

const noteAt = (song: Song, slot: number, index = 0): NoteEvent => {
  const lane = song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];
  const cell = lane[slot];
  if (cell === null || cell === undefined || cell === "-") throw new Error("no note");
  return cell.notes[index]!;
};

const span = (over: Partial<TechniqueSpan> = {}): TechniqueSpan => ({
  id: "pm1",
  kind: "palm_mute",
  trackId: TRACK,
  startTicks: 0,
  endTicks: 768,
  stringIndices: [4, 5],
  ...over,
});

describe("138. one axis at a time", () => {
  it("writes an attack and leaves every other axis alone", () => {
    const before = twoStrings({ pitchGesture: { kind: "bend", targetCents: 200 } });
    const result = applyAttackWrite(before, {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      attack: "accent",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = noteAt(result.song, 0);
    expect(note.attack).toBe("accent");
    /* The bend the reader did not touch is still the bend they wrote. */
    expect(note.pitchGesture).toEqual({ kind: "bend", targetCents: 200 });
    expect(note.pitch).toBe(noteAt(before, 0).pitch);
    expect(note.position).toEqual(noteAt(before, 0).position);
  });

  it("removes an attack without removing the note", () => {
    const written = applyAttackWrite(twoStrings(), {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      attack: "ghost",
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const cleared = applyAttackWrite(written.song, {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      attack: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(noteAt(cleared.song, 0).attack).toBeUndefined();
    expect(noteAt(cleared.song, 0).pitch).toBe(noteAt(twoStrings(), 0).pitch);
  });

  it("writes a picking direction and nothing else", () => {
    const before = twoStrings();
    const result = applyPickingWrite(before, {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      picking: "down",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0).picking).toBe("down");
    expect(noteAt(result.song, 0).durationTicks).toBe(noteAt(before, 0).durationTicks);
    /* The other voice of the same onset is a different note and is untouched. */
    expect(noteAt(result.song, 0, 1).picking).toBeUndefined();
  });

  it("applies one attack to every onset a selection names", () => {
    const result = applyAttackWrite(twoStrings(), {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0 }, { timeTicks: 192 }],
      attack: "accent",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* No `noteIndex`, so both voices of both onsets. */
    for (const slot of [0, 2]) {
      for (const voice of [0, 1]) {
        expect(noteAt(result.song, slot, voice).attack).toBe("accent");
      }
    }
  });

  it("refuses an attack beside the legacy one that answers the same question", () => {
    const result = applyAttackWrite(twoStrings({ articulation: "accent" }), {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      attack: "ghost",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("conflicting_technique");
    expect(result.message).toMatch(/\S/u);
  });

  it("says so rather than writing nothing when the note is already like that", () => {
    const written = applyAttackWrite(twoStrings(), {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      attack: null,
    });
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error).toBe("unchanged");
  });

  it("refuses an empty selection instead of touching the whole track", () => {
    const result = applyAttackWrite(twoStrings(), {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [],
      attack: "accent",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("nothing_selected");
  });
});

describe("139. a span reaches its own strings and no others", () => {
  it("holds over the strings it was drawn on", () => {
    const result = applySpanWrite(twoStrings(), { sectionId: SECTION, span: span() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spans = result.song.sections[0]!.techniqueSpans ?? [];
    const read = (stringIndex: number, timeTicks: number) =>
      resolveExpression(
        {},
        { trackId: TRACK, timeTicks, stringIndex, spans },
      ).techniques.map((held) => held.kind);
    expect(read(5, 0)).toEqual(["palm_mute"]);
    expect(read(5, 192)).toEqual(["palm_mute"]);
    /* The top string goes on ringing over it. That is the whole point. */
    expect(read(1, 0)).toEqual([]);
  });

  it("lets a mute on the low strings live beside a ring on the top one", () => {
    const first = applySpanWrite(twoStrings(), { sectionId: SECTION, span: span() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applySpanWrite(first.song, {
      sectionId: SECTION,
      span: span({ id: "lr1", kind: "let_ring", stringIndices: [0, 1] }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect((second.song.sections[0]!.techniqueSpans ?? []).map((s) => s.id)).toEqual([
      "pm1",
      "lr1",
    ]);
  });

  it("refuses a second mute over a string that already has one", () => {
    const first = applySpanWrite(twoStrings(), { sectionId: SECTION, span: span() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applySpanWrite(first.song, {
      sectionId: SECTION,
      span: span({ id: "pm2", stringIndices: [5] }),
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe("duplicate_span");
  });

  it("replaces a span rather than duplicating it when the id is the same", () => {
    const first = applySpanWrite(twoStrings(), { sectionId: SECTION, span: span() });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const edited = applySpanWrite(first.song, {
      sectionId: SECTION,
      span: span({ endTicks: 384 }),
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const spans = edited.song.sections[0]!.techniqueSpans ?? [];
    expect(spans).toHaveLength(1);
    expect(spans[0]!.endTicks).toBe(384);
  });

  it("takes a span away and leaves the notes exactly as they were", () => {
    const before = twoStrings();
    const written = applySpanWrite(before, { sectionId: SECTION, span: span() });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const removed = applySpanRemove(written.song, { sectionId: SECTION, spanId: "pm1" });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.song.sections[0]!.techniqueSpans).toBeUndefined();
    expect(removed.song.sections[0]!.bars).toEqual(before.sections[0]!.bars);
  });

  it("refuses to remove a span that is not there, without touching the song", () => {
    const before = twoStrings();
    const result = applySpanRemove(before, { sectionId: SECTION, spanId: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_such_span");
  });
});

describe("140. legacy notes are converted only where the reader was working", () => {
  it("moves the legacy mute onto the span, on the covered strings only", () => {
    /*
     * §7: nothing migrates on open or on an unrelated edit. Drawing a span
     * over notes that already say `palm_mute` is the one moment a conversion
     * is what the reader meant — and it is lossless, because the legacy field
     * held one value and that value is the one moving.
     */
    const before = twoStrings({ articulation: "palm_mute" });
    expect(noteAt(before, 0, 0).articulation).toBe("palm_mute");
    expect(noteAt(before, 0, 1).articulation).toBe("palm_mute");

    const result = applySpanWrite(before, { sectionId: SECTION, span: span() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* String 5 is under the span: the note gives up its legacy value. */
    expect(noteAt(result.song, 0, 0).articulation).toBeUndefined();
    /* String 1 is not: it keeps saying what it said, and goes on sounding
       exactly as it did. Two ways of saying it coexist, correctly. */
    expect(noteAt(result.song, 0, 1).articulation).toBe("palm_mute");
  });

  it("does not reach a note outside the span's own ticks", () => {
    const before = twoStrings({ articulation: "palm_mute" });
    const result = applySpanWrite(before, {
      sectionId: SECTION,
      span: span({ endTicks: 96 }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0, 0).articulation).toBeUndefined();
    /* The second onset is at tick 192, past the span's end. */
    expect(noteAt(result.song, 2, 0).articulation).toBe("palm_mute");
  });

  it("moves a legacy let ring the same way, and only for a let-ring span", () => {
    const before = twoStrings({ letRing: true });
    const muted = applySpanWrite(before, { sectionId: SECTION, span: span() });
    expect(muted.ok).toBe(false);
    if (muted.ok) return;
    /* A mute over a ringing note is a contradiction, not a conversion. */
    expect(muted.error).toBe("conflicting_technique");

    const rung = applySpanWrite(before, {
      sectionId: SECTION,
      span: span({ kind: "let_ring" }),
    });
    expect(rung.ok).toBe(true);
    if (!rung.ok) return;
    expect(noteAt(rung.song, 0, 0).letRing).toBeUndefined();
    expect(noteAt(rung.song, 0, 1).letRing).toBe(true);
  });

  it("leaves a song with no spans in it byte-identical when nothing is written", () => {
    /* The no-migration rule, asked directly: reading, resolving and writing
       an unrelated axis must not grow a `techniqueSpans` field. */
    const before = twoStrings({ articulation: "palm_mute" });
    const result = applyPickingWrite(before, {
      sectionId: SECTION,
      trackId: TRACK,
      targets: [{ timeTicks: 0, noteIndex: 0 }],
      picking: "up",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[0]!.techniqueSpans).toBeUndefined();
    expect(noteAt(result.song, 0, 0).articulation).toBe("palm_mute");
    expect(noteAt(result.song, 2, 0).articulation).toBe("palm_mute");
  });
});

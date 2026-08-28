import { describe, expect, it } from "vitest";

import {
  arpeggioToChord,
  chordToArpeggio,
  setChordStrum,
} from "@/lib/song/chord-shape";
import { setNoteDuration } from "@/lib/song/note-duration";
import { retuneHarmony, type Harmony } from "@/lib/song/retune-harmony";
import {
  createEditHistory,
  currentSong,
  recordEdit,
  redo,
  undo,
  type HistoryAction,
} from "@/lib/song/edit-history";
import { historyActionLabel } from "@/lib/song/history-labels";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import { applyEdit } from "@/lib/song/edit";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";
import { songSchema, type MelodicSlot, type NoteEvent, type Song } from "@/lib/song/schema";

/** The lowest string of the chord this file writes everything onto. */
function firstNote(subject: Song): NoteEvent | null {
  const slot = subject.sections[0]!.bars[0]!.slots[TRACK]![0];
  if (slot === null || slot === undefined || slot === "-" || Array.isArray(slot)) {
    return null;
  }
  return slot.notes[0] ?? null;
}

const TRACK = "gtr";
const TARGET = { sectionId: "s1", barIndex: 0, trackId: TRACK, slotIndex: 0 };

function chordSong(): Song {
  const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  slots[0] = {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2", position: { string: 1, fret: 2 } },
      { pitch: "E3", position: { string: 2, fret: 2 } },
    ],
  };
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution: 16 })])],
  );
}

/**
 * 2T-B §8. Every transform has to reach the reader through the same chain as
 * every other edit: one command, one history entry, an undo that gives the
 * song back exactly, and a storage round trip that does not change a byte.
 * A pure core that nothing can undo is not a feature.
 */
describe("every transform is one command and one step of history", () => {
  const cases: readonly {
    name: string;
    action: HistoryAction;
    label: string;
    run: (subject: Song) => Song | null;
  }[] = [
    {
      name: "chord to arpeggio",
      action: { kind: "chord_shape", command: "to_arpeggio" },
      label: "Akoru arpeje çevirme",
      run: (subject) => {
        const result = chordToArpeggio(subject, TARGET, {
          direction: "down_to_up",
          stepTicks: 48,
          ring: true,
        });
        return result.ok ? result.song : null;
      },
    },
    {
      name: "arpeggio back to chord",
      action: { kind: "chord_shape", command: "to_chord" },
      label: "Arpeji akora toplama",
      run: (subject) => {
        const spread = chordToArpeggio(subject, TARGET, {
          direction: "down_to_up",
          stepTicks: 48,
          ring: false,
        });
        if (!spread.ok) return null;
        const result = arpeggioToChord(spread.song, TARGET, 8);
        return result.ok ? result.song : null;
      },
    },
    {
      name: "strum direction",
      action: { kind: "chord_shape", command: "set_strum" },
      label: "Vuruş yönü verme",
      run: (subject) => {
        const result = setChordStrum(subject, TARGET, "down");
        return result.ok ? result.song : null;
      },
    },
    {
      name: "note duration",
      action: { kind: "note_duration", direction: "longer" },
      label: "Nota süresini uzatma",
      run: (subject) => {
        const result = setNoteDuration(subject, { ...TARGET, noteIndex: 0 }, 192);
        return result.ok ? result.song : null;
      },
    },
    {
      name: "retune harmony",
      action: { kind: "retune_harmony" },
      label: "Figürü yeni akora taşıma",
      run: (subject) => {
        const Em: Harmony = { root: "E", intervals: [0, 3, 7] };
        const Am: Harmony = { root: "A", intervals: [0, 3, 7] };
        const result = retuneHarmony(
          subject,
          { ...TARGET, fromSlot: 0, toSlot: 16 },
          Em,
          Am,
        );
        return result.ok ? result.song : null;
      },
    },
  ];

  for (const entry of cases) {
    describe(entry.name, () => {
      it("does not touch the song it was given", () => {
        const subject = chordSong();
        const snapshot = JSON.stringify(subject);
        expect(entry.run(subject)).not.toBeNull();
        expect(JSON.stringify(subject)).toBe(snapshot);
      });

      /* Running it twice is what a preview and an apply are. */
      it("gives the same answer to a preview and to an apply", () => {
        const subject = chordSong();
        expect(JSON.stringify(entry.run(subject))).toBe(
          JSON.stringify(entry.run(subject)),
        );
      });

      it("takes exactly one step of history, and undo gives the song back", () => {
        const before = chordSong();
        const after = entry.run(before);
        expect(after).not.toBeNull();
        if (after === null) return;

        const recorded = recordEdit(createEditHistory(before), after, entry.action);
        expect(JSON.stringify(currentSong(recorded))).toBe(JSON.stringify(after));

        const undone = undo(recorded);
        expect(JSON.stringify(currentSong(undone))).toBe(JSON.stringify(before));

        const redone = redo(undone);
        expect(JSON.stringify(currentSong(redone))).toBe(JSON.stringify(after));
      });

      it("names itself in the history line", () => {
        expect(historyActionLabel(entry.action)).toBe(entry.label);
      });

      it("survives a storage round trip unchanged", () => {
        const after = entry.run(chordSong());
        expect(after).not.toBeNull();
        if (after === null) return;
        const written = JSON.stringify(nextEnvelope(after, decideLoad(null)));
        const read = decideLoad(written);
        expect(read.kind).toBe("envelope");
        if (read.kind !== "envelope") return;
        expect(JSON.stringify(read.song)).toBe(JSON.stringify(after));
      });
    });
  }

  it("names taking a strum mark off differently from putting one on", () => {
    expect(historyActionLabel({ kind: "chord_shape", command: "clear_strum" })).toBe(
      "Vuruş yönünü kaldırma",
    );
  });

  it("names shortening differently from lengthening", () => {
    expect(historyActionLabel({ kind: "note_duration", direction: "shorter" })).toBe(
      "Nota süresini kısaltma",
    );
  });
});

/**
 * 2T-C §9 and §11. The three techniques a reader writes through the fret
 * sheet reach history by the same road as everything above: one command, one
 * step, an undo that gives back exactly the bytes there were.
 *
 * They are separated from the block above because they are written by
 * `applyEdit` rather than by a transform of their own — and that is the point
 * of testing them here: a new command that forgot to go through the store
 * would pass every test in its own file and fail these.
 */
describe("a technique, a length and a let-ring are each one step", () => {
  const cases: readonly {
    name: string;
    run: (subject: Song) => Song | null;
    changes: (subject: Song) => unknown;
  }[] = [
    {
      name: "a technique written on one string",
      run: (subject) => {
        const result = applyEdit(subject, {
          kind: "set_articulation",
          target: TARGET,
          stringIndex: 0,
          articulation: "ghost",
        });
        return result.ok ? result.song : null;
      },
      changes: (subject) => firstNote(subject)?.articulation,
    },
    {
      name: "a note left to ring",
      run: (subject) => {
        const result = applyEdit(subject, {
          kind: "set_let_ring",
          target: TARGET,
          stringIndex: 0,
          letRing: true,
        });
        return result.ok ? result.song : null;
      },
      changes: (subject) => firstNote(subject)?.letRing,
    },
    {
      name: "a note written with a length of its own",
      run: (subject) => {
        const result = applyEdit(subject, {
          kind: "set_note",
          target: { ...TARGET, slotIndex: 4 },
          stringIndex: 0,
          fret: 3,
          durationTicks: 72,
        });
        return result.ok ? result.song : null;
      },
      changes: (subject) => {
        const slot = subject.sections[0]!.bars[0]!.slots[TRACK]![4];
        if (slot === null || slot === undefined || slot === "-" || Array.isArray(slot)) {
          return null;
        }
        return slot.notes[0]?.durationTicks;
      },
    },
  ];

  for (const entry of cases) {
    describe(entry.name, () => {
      it("does not touch the song it was given", () => {
        const subject = chordSong();
        const snapshot = JSON.stringify(subject);
        expect(entry.run(subject)).not.toBeNull();
        expect(JSON.stringify(subject)).toBe(snapshot);
      });

      it("actually changes what it claims to change", () => {
        const before = chordSong();
        const after = entry.run(before);
        expect(after).not.toBeNull();
        if (after === null) return;
        expect(entry.changes(after)).not.toEqual(entry.changes(before));
      });

      it("takes exactly one step of history, and undo gives the song back", () => {
        const before = chordSong();
        const after = entry.run(before);
        expect(after).not.toBeNull();
        if (after === null) return;

        const recorded = recordEdit(createEditHistory(before), after, {
          kind: "note_edit",
        });
        expect(JSON.stringify(currentSong(recorded))).toBe(JSON.stringify(after));

        const undone = undo(recorded);
        expect(JSON.stringify(currentSong(undone))).toBe(JSON.stringify(before));

        const redone = redo(undone);
        expect(JSON.stringify(currentSong(redone))).toBe(JSON.stringify(after));
      });

      it("survives a storage round trip unchanged", () => {
        const after = entry.run(chordSong());
        expect(after).not.toBeNull();
        if (after === null) return;
        const written = JSON.stringify(nextEnvelope(after, decideLoad(null)));
        const read = decideLoad(written);
        expect(read.kind).toBe("envelope");
        if (read.kind !== "envelope") return;
        expect(JSON.stringify(read.song)).toBe(JSON.stringify(after));
      });

      it("reads as a valid song afterwards", () => {
        const after = entry.run(chordSong());
        expect(songSchema.safeParse(after).success).toBe(true);
      });
    });
  }

  /*
   * Setting a technique back to normal removes the field rather than writing
   * "normal" into it, so the song that never had one and the song that had
   * one taken off are the same bytes — and undo of either is the same undo.
   */
  it("leaves no trace when a technique is set and then cleared", () => {
    const before = chordSong();
    const set = applyEdit(before, {
      kind: "set_articulation",
      target: TARGET,
      stringIndex: 0,
      articulation: "pinch_harmonic",
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const cleared = applyEdit(set.song, {
      kind: "set_articulation",
      target: TARGET,
      stringIndex: 0,
      articulation: null,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(JSON.stringify(cleared.song)).toBe(JSON.stringify(before));
  });

  /* The same for let-ring: false removes the field, it does not write it. */
  it("leaves no trace when a let-ring is put on and taken off", () => {
    const before = chordSong();
    const on = applyEdit(before, {
      kind: "set_let_ring",
      target: TARGET,
      stringIndex: 0,
      letRing: true,
    });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const off = applyEdit(on.song, {
      kind: "set_let_ring",
      target: TARGET,
      stringIndex: 0,
      letRing: false,
    });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(JSON.stringify(off.song)).toBe(JSON.stringify(before));
  });
});

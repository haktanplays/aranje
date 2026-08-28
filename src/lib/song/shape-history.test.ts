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
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";
import type { MelodicSlot, Song } from "@/lib/song/schema";

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

/**
 * What one tap writes to, and what it does not (2Q-B §12).
 *
 * The write table for cross-instrument entry is short on purpose:
 *
 * | destination        | drum hit | pitched note | refused command |
 * | ------------------ | -------- | ------------ | --------------- |
 * | the Song           | one slot | one slot     | nothing         |
 * | history            | one step | one step     | nothing         |
 * | project storage    | via the store's own save, never directly   |
 * | the project file   | only when the reader exports               |
 *
 * The third and fourth rows are not tested here because they are not this
 * layer's to do: the commands return a candidate and the store decides when
 * a song is saved. That the commands cannot reach storage at all is asserted
 * in the boundary test next door, which is the stronger claim.
 */
import { describe, expect, it } from "vitest";

import {
  createEditHistory,
  currentSong,
  recordEdit,
  redo,
  redoAction,
  undo,
  undoAction,
  type HistoryAction,
} from "@/lib/song/edit-history";
import { historyActionLabel } from "@/lib/song/history-labels";
import { insertDrumHit, insertPitchedNote, removeDrumHit } from "@/lib/song/event-entry";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { ticksPerSlot } from "@/lib/music/timing";
import { songSchema, type Bar, type DrumSlot, type Song } from "@/lib/song/schema";

const SECTION = SAMPLE_SONG.sections[0]!.id;
const PER_SLOT = ticksPerSlot(SAMPLE_SONG.sections[0]!.bars[0]!.resolution);

const KEYS = {
  id: "keys",
  name: "Piyano",
  instrumentId: "piano",
  presetId: "grand",
  volumeDb: -6,
} as const;

function withKeys(): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  next.tracks = [...next.tracks, { ...KEYS }];
  for (const section of next.sections) {
    for (const bar of section.bars) {
      bar.slots[KEYS.id] = bar.slots["gtr"]!.map(() => null) as Bar["slots"][string];
    }
  }
  return songSchema.parse(next);
}

const DRUM_INSERT: HistoryAction = { kind: "drum_entry", command: "insert" };
const DRUM_REMOVE: HistoryAction = { kind: "drum_entry", command: "remove" };
const PITCHED_INSERT: HistoryAction = { kind: "pitched_entry", command: "insert" };

describe("227. one tap, one step of history", () => {
  it("gives a drum hit its own undoable step", () => {
    const written = insertDrumHit(
      SAMPLE_SONG,
      { sectionId: SECTION, trackId: "drums", ticks: PER_SLOT },
      { piece: "snare" },
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    let history = createEditHistory(SAMPLE_SONG);
    history = recordEdit(history, written.song, DRUM_INSERT);
    expect(undoAction(history)).toEqual(DRUM_INSERT);

    history = undo(history);
    expect(JSON.stringify(currentSong(history))).toBe(JSON.stringify(SAMPLE_SONG));
    expect(redoAction(history)).toEqual(DRUM_INSERT);

    history = redo(history);
    expect(JSON.stringify(currentSong(history))).toBe(JSON.stringify(written.song));
  });

  it("gives a pitched note its own undoable step", () => {
    const song = withKeys();
    const written = insertPitchedNote(
      song,
      { sectionId: SECTION, trackId: KEYS.id, ticks: PER_SLOT },
      { pitch: "A3" },
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    let history = recordEdit(createEditHistory(song), written.song, PITCHED_INSERT);
    history = undo(history);
    expect(JSON.stringify(currentSong(history))).toBe(JSON.stringify(song));
  });

  it("separates writing from erasing, so undo goes back one tap and not two", () => {
    const first = insertDrumHit(
      SAMPLE_SONG,
      { sectionId: SECTION, trackId: "drums", ticks: PER_SLOT },
      { piece: "snare" },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = removeDrumHit(
      first.song,
      { sectionId: SECTION, trackId: "drums", ticks: PER_SLOT },
      "snare",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    let history = createEditHistory(SAMPLE_SONG);
    history = recordEdit(history, first.song, DRUM_INSERT);
    history = recordEdit(history, second.song, DRUM_REMOVE);
    expect(undoAction(history)).toEqual(DRUM_REMOVE);

    history = undo(history);
    // Back to the hit, not back to before it.
    expect(JSON.stringify(currentSong(history))).toBe(JSON.stringify(first.song));
  });

  it("names every step in the reader's words, never in the code's", () => {
    for (const action of [
      DRUM_INSERT,
      DRUM_REMOVE,
      PITCHED_INSERT,
      { kind: "pitched_entry", command: "replace" } as const,
      { kind: "pitched_entry", command: "remove" } as const,
    ]) {
      const label = historyActionLabel(action);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_");
      expect(label).not.toContain("entry");
    }
  });

  it("writes nothing at all when a command is refused", () => {
    const before = JSON.stringify(SAMPLE_SONG);
    const refused = insertDrumHit(
      SAMPLE_SONG,
      // Half a slot in: the grid cannot represent it, so nothing is written.
      { sectionId: SECTION, trackId: "drums", ticks: Math.floor(PER_SLOT / 2) },
      { piece: "snare" },
    );
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(SAMPLE_SONG)).toBe(before);
  });

  it("lays a lane and writes the hit as one step, never as two", () => {
    const song = structuredClone(SAMPLE_SONG) as Song;
    for (const section of song.sections) {
      for (const bar of section.bars) delete bar.slots["drums"];
    }
    const parsed = songSchema.parse(song);
    const written = insertDrumHit(
      parsed,
      { sectionId: SECTION, trackId: "drums", ticks: 0 },
      { piece: "kick" },
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;

    let history = recordEdit(createEditHistory(parsed), written.song, DRUM_INSERT);
    const lane = written.song.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[];
    expect(lane[0]).toEqual([{ piece: "kick" }]);

    // One undo, and the lane goes with the hit that needed it.
    history = undo(history);
    expect(
      Object.prototype.hasOwnProperty.call(
        currentSong(history).sections[0]!.bars[0]!.slots,
        "drums",
      ),
    ).toBe(false);
  });
});

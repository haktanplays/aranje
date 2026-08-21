/**
 * The commit gate, counted (spec 13.13, K-44).
 *
 * `edit-history.test.ts` checks the arithmetic of a list and a cursor. This
 * file checks the promise the app actually makes: one edit is one write and
 * one step, a refused edit is neither, and undo and redo move without leaving
 * anything behind them.
 *
 * Everything here counts. "One write" is a number from a storage double, not
 * an impression from the fact that the right song came back.
 */
import { describe, expect, it } from "vitest";

import { historyLimits } from "@/lib/limits";
import { applyBarCommand } from "@/lib/song/bar-transform";
import type { HistoryAction } from "@/lib/song/edit-history";
import { guitarTrack, restSlots, section, song as makeSong } from "@/lib/song/fixtures";
import { createSongStore, type SongStore } from "@/lib/song/song-store";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";
import { applyTransform } from "@/lib/song/transform";

const NOTE: HistoryAction = { kind: "note_edit" };
const COPILOT: HistoryAction = { kind: "copilot_apply", skill: "rhythm_guitar" };

function countingStorage(): StorageLike & {
  writes: number;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    writes: 0,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      // Only the song counts. A quarantine write is not an edit.
      if (key === SONG_KEY) this.writes += 1;
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const note = (pitch: string): MelodicSlot => ({
  notes: [{ pitch, position: { string: 0, fret: 0 }, velocity: 100 }],
});

const riff = (): MelodicSlot[] => {
  const slots = restSlots(8);
  slots[0] = note("E2");
  slots[4] = note("G2");
  return slots;
};

const bar = (slots: Record<string, MelodicSlot[]> = {}): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots,
});

function fixture(): Song {
  return makeSong(
    [guitarTrack({ id: "gtr" }), guitarTrack({ id: "gtr2", name: "İkinci" })],
    [section([bar({ gtr: riff() }), bar(), bar({ gtr: riff() })])],
  );
}

const titled = (song: Song, title: string): Song => ({ ...song, title });

function storeOf(song: Song): {
  store: SongStore;
  storage: ReturnType<typeof countingStorage>;
} {
  const storage = countingStorage();
  const store = createSongStore({ song, outcome: "stored" }, storage);
  return { store, storage };
}

const storedTitle = (storage: { map: Map<string, string> }) =>
  (JSON.parse(storage.map.get(SONG_KEY) ?? "{}") as Partial<Song>).title;

describe("11. hydration is not an edit", () => {
  it("starts with nothing to undo and nothing written", () => {
    const { store, storage } = storeOf(fixture());
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(storage.writes).toBe(0);
  });
});

describe("12. one edit is one write and one step", () => {
  it("writes exactly once and offers exactly one undo", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);

    expect(store.commit(titled(source, "B"), NOTE)).toBe(true);

    expect(storage.writes).toBe(1);
    expect(store.getSnapshot().undoDepth).toBe(1);
    expect(store.getSnapshot().redoDepth).toBe(0);
    expect(storedTitle(storage)).toBe("B");
  });

  it("publishes exactly once", () => {
    const source = fixture();
    const { store } = storeOf(source);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.commit(titled(source, "B"), NOTE);
    expect(notified).toBe(1);
  });
});

describe("13. a candidate that changes nothing is not an edit", () => {
  it("refuses the song it already holds", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);
    expect(store.commit(source, NOTE)).toBe(false);
    expect(storage.writes).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("refuses a rebuilt song that is the same music", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);
    /*
     * The shape a spread leaves behind: a different object, the same music,
     * and — because the keys were rewritten — a different byte string. An
     * undo for this would be an undo that visibly does nothing.
     */
    const rebuilt: Song = {
      ...source,
      sections: source.sections.map((entry) => ({
        ...entry,
        bars: entry.bars.map((entryBar) => ({
          slots: { ...entryBar.slots },
          resolution: entryBar.resolution,
          timeSignature: entryBar.timeSignature,
        })),
      })),
    };
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(source));
    expect(store.commit(rebuilt, NOTE)).toBe(false);
    expect(storage.writes).toBe(0);
  });
});

describe("14. a candidate the schema refuses never becomes a step", () => {
  it("leaves history and storage exactly as they were", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);
    const broken = { ...source, bpm: 9000 } as Song;

    expect(store.commit(broken, NOTE)).toBe(false);
    expect(storage.writes).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().song).toBe(source);
  });
});

describe("15. a refused command never reaches the store", () => {
  it("records nothing when a bar command is turned down", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);

    // Deleting every bar of the only section: the core refuses this.
    const result = applyBarCommand(
      source,
      { scope: "full", sectionId: "s1", startBarIndex: 0, endBarIndex: 2 },
      { kind: "delete_bars" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(storage.writes).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});

describe("16. a warning is still an edit", () => {
  it("records a step for a command that succeeded with something to say", () => {
    /*
     * A twelve-fret jump between neighbouring onsets: playable, unusual, and
     * therefore a warning rather than a refusal (spec 10.3). A warning is
     * information about the music, not a verdict on the edit — so the edit
     * stands and is a normal step someone can undo.
     */
    const jump = restSlots(8);
    jump[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, velocity: 100 }] };
    jump[1] = { notes: [{ pitch: "E3", position: { string: 0, fret: 12 }, velocity: 100 }] };
    const source = makeSong(
      [guitarTrack({ id: "gtr" })],
      [section([bar({ gtr: jump }), bar()])],
    );
    const { store, storage } = storeOf(source);

    const result = applyTransform(
      source,
      { sectionId: "s1", trackId: "gtr", startTicks: 0, endTicks: 768 },
      { kind: "transpose_pitch", semitones: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);

    expect(
      store.commit(result.song, {
        kind: "selection_transform",
        command: "transpose_pitch",
      }),
    ).toBe(true);
    expect(storage.writes).toBe(1);
    expect(store.getSnapshot().undoDepth).toBe(1);
  });
});

describe("17. a structural bar edit is one step", () => {
  it("removes bars and offers a single undo back to all of them", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);

    const result = applyBarCommand(
      source,
      { scope: "full", sectionId: "s1", startBarIndex: 0, endBarIndex: 1 },
      { kind: "delete_bars" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    store.commit(result.song, {
      kind: "bar_transform",
      command: "delete_bars",
      scope: "full",
    });
    expect(store.getSnapshot().song.sections[0]?.bars.length).toBe(1);
    expect(storage.writes).toBe(1);

    store.undo();
    expect(store.getSnapshot().song.sections[0]?.bars.length).toBe(3);
    expect(storage.writes).toBe(2);
    expect(store.getSnapshot().undoDepth).toBe(0);
  });
});

describe("18. an applied suggestion is one step", () => {
  it("comes back in one undo, and says whose it was", () => {
    const source = fixture();
    const { store } = storeOf(source);
    store.commit(titled(source, "Aranjeli"), COPILOT);

    expect(store.getSnapshot().undoLabel).toBe(
      "Geri al: Aranje önerisini uygulama",
    );
    store.undo();
    expect(store.getSnapshot().song.title).toBe(source.title);
    expect(store.getSnapshot().redoLabel).toBe(
      "Yinele: Aranje önerisini uygulama",
    );
  });
});

describe("19. undo and redo are one write each", () => {
  it("writes once per step and adds no new entry", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);
    expect(storage.writes).toBe(2);

    store.undo();
    expect(storage.writes).toBe(3);
    expect(store.getSnapshot().undoDepth).toBe(1);
    expect(store.getSnapshot().redoDepth).toBe(1);
    expect(storedTitle(storage)).toBe("B");

    store.redo();
    expect(storage.writes).toBe(4);
    expect(store.getSnapshot().undoDepth).toBe(2);
    expect(store.getSnapshot().redoDepth).toBe(0);
    expect(storedTitle(storage)).toBe("C");
  });
});

describe("20. an undo or redo with nowhere to go writes nothing", () => {
  it("stays silent at both ends", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);

    store.undo();
    store.redo();
    expect(storage.writes).toBe(0);

    store.commit(titled(source, "B"), NOTE);
    store.redo();
    expect(storage.writes).toBe(1);

    store.undo();
    store.undo();
    expect(storage.writes).toBe(2);
  });

  it("publishes nothing either", () => {
    const { store } = storeOf(fixture());
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.undo();
    store.redo();
    expect(notified).toBe(0);
  });
});

describe("21. a new edit after an undo drops the redo branch", () => {
  it("cannot walk forward into the abandoned future", () => {
    const source = fixture();
    const { store } = storeOf(source);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);
    store.commit(titled(source, "D"), NOTE);
    store.undo();
    store.undo();
    expect(store.getSnapshot().song.title).toBe("B");

    store.commit(titled(source, "E"), NOTE);
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(store.getSnapshot().redoDepth).toBe(0);

    store.redo();
    expect(store.getSnapshot().song.title).toBe("E");
  });
});

describe("22. the depth is bounded by the central limit", () => {
  it("never offers more undos than the limit allows", () => {
    const source = fixture();
    const { store } = storeOf(source);
    for (let step = 1; step <= historyLimits.maxUndoSteps + 10; step += 1) {
      store.commit(titled(source, `s${step}`), NOTE);
    }
    expect(store.getSnapshot().undoDepth).toBe(historyLimits.maxUndoSteps);
  });
});

describe("23. a baseline replacement is not a step", () => {
  it("resets both directions without writing", () => {
    const source = fixture();
    const { store, storage } = storeOf(source);
    store.commit(titled(source, "B"), NOTE);
    const before = storage.writes;

    store.replaceBaseline(titled(source, "Başka şarkı"));
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(store.getSnapshot().song.title).toBe("Başka şarkı");
    // The baseline is where the song came from, not somewhere it was written.
    expect(storage.writes).toBe(before);
  });
});

describe("24. undoing gives back the same bytes", () => {
  it("returns a song identical to the one that was there", () => {
    const source = fixture();
    const { store } = storeOf(source);
    const before = JSON.stringify(source);

    const result = applyBarCommand(
      source,
      { scope: "track", sectionId: "s1", trackId: "gtr", startBarIndex: 0, endBarIndex: 0 },
      { kind: "delete_bars" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    store.commit(result.song, {
      kind: "bar_transform",
      command: "delete_bars",
      scope: "track",
    });
    store.undo();

    expect(JSON.stringify(store.getSnapshot().song)).toBe(before);
  });
});

describe("25. the same sequence twice gives the same store", () => {
  it("is byte-equivalent across five runs", () => {
    const run = () => {
      const source = fixture();
      const { store } = storeOf(source);
      store.commit(titled(source, "B"), NOTE);
      store.commit(titled(source, "C"), NOTE);
      store.undo();
      store.commit(titled(source, "D"), COPILOT);
      const snapshot = store.getSnapshot();
      return JSON.stringify({
        song: snapshot.song,
        undoDepth: snapshot.undoDepth,
        redoDepth: snapshot.redoDepth,
        undoLabel: snapshot.undoLabel,
        redoLabel: snapshot.redoLabel,
      });
    };
    expect(new Set(Array.from({ length: 5 }, run)).size).toBe(1);
  });
});

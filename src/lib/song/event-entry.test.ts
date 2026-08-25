/**
 * Writing a drum hit and a pitched note (2Q-B §14).
 *
 * The claims here are the ones the screens rest on: a moment addresses one
 * slot and nothing is rounded to reach it, a refused command leaves the song
 * byte-identical, and a lane materialised on the way to a refusal never
 * survives it.
 */
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/copilot/fingerprint";
import { buildNotatedPlan } from "@/lib/audio/schedule";
import {
  hitAt,
  insertDrumHit,
  insertPitchedNote,
  isPitchedTrack,
  landOn,
  removeDrumHit,
  removePitchedNote,
} from "@/lib/song/event-entry";
import { EVENT_ENTRY_MESSAGES } from "@/lib/song/event-entry-messages";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Bar, type DrumSlot, type Song } from "@/lib/song/schema";
import { barsWrittenIn } from "@/lib/song/track-lanes";
import { ticksPerSlot } from "@/lib/music/timing";

const SECTION = SAMPLE_SONG.sections[0]!.id;
const frozen = canonicalJson(SAMPLE_SONG);

/** The sample song with one track's key removed from every bar. */
function withMissingKeys(trackId: string): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  for (const section of next.sections) {
    for (const bar of section.bars) delete bar.slots[trackId];
  }
  return next;
}

/** A pitched track that arrived in a file: no fretboard, no position. */
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

const at = (trackId: string, ticks: number) => ({ sectionId: SECTION, trackId, ticks });

const drumsAt = (song: Song, barIndex: number, slotIndex: number): DrumSlot =>
  (song.sections[0]!.bars[barIndex]!.slots["drums"] as DrumSlot[])[slotIndex]!;

describe("215. a moment names one slot, and nothing is rounded", () => {
  it("finds the bar and slot a tick belongs to", () => {
    const bar0 = SAMPLE_SONG.sections[0]!.bars[0]!;
    const per = ticksPerSlot(bar0.resolution);
    const landing = landOn(SAMPLE_SONG, at("drums", per * 3));
    expect(typeof landing === "string" ? landing : landing.slotIndex).toBe(3);
    expect(typeof landing === "string" ? landing : landing.barIndex).toBe(0);
  });

  it("crosses into the next bar at exactly the right tick", () => {
    const bar0 = SAMPLE_SONG.sections[0]!.bars[0]!;
    const per = ticksPerSlot(bar0.resolution);
    const count = (bar0.slots["drums"] as DrumSlot[]).length;
    const landing = landOn(SAMPLE_SONG, at("drums", per * count));
    expect(typeof landing === "string" ? landing : landing.barIndex).toBe(1);
    expect(typeof landing === "string" ? landing : landing.slotIndex).toBe(0);
  });

  it("refuses a tick that does not sit on the grid", () => {
    const per = ticksPerSlot(SAMPLE_SONG.sections[0]!.bars[0]!.resolution);
    expect(landOn(SAMPLE_SONG, at("drums", per + 1))).toBe("off_grid_target");
  });

  /*
   * A negative tick is the one case the modulo arithmetic below cannot
   * catch: -192 divides exactly into a slot and compares as "before the end
   * of bar one". Without a sign check it reaches a lane index of -1, which
   * on a melodic lane sets a property nobody reads and reports success for a
   * write that did nothing (2Q-B §17, probe 3).
   */
  it("refuses a negative tick even when it lands exactly on the grid", () => {
    const per = ticksPerSlot(SAMPLE_SONG.sections[0]!.bars[0]!.resolution);
    for (const trackId of ["drums", "gtr"]) {
      const landing = landOn(SAMPLE_SONG, at(trackId, -per));
      expect(landing).toBe("off_grid_target");
    }
    const drum = insertDrumHit(SAMPLE_SONG, at("drums", -per), { piece: "snare" });
    expect(drum.ok).toBe(false);
    if (!drum.ok) expect(drum.code).toBe("off_grid_target");

    const song = withKeys();
    const note = insertPitchedNote(song, at(KEYS.id, -per), { pitch: "A3" });
    expect(note.ok).toBe(false);
    if (!note.ok) expect(note.code).toBe("off_grid_target");
  });

  it("names a section that is not in the song, rather than using another one", () => {
    const landing = landOn(SAMPLE_SONG, {
      sectionId: "no-such-section",
      trackId: "drums",
      ticks: 0,
    });
    expect(landing).toBe("section_not_found");
    const result = insertDrumHit(
      SAMPLE_SONG,
      { sectionId: "no-such-section", trackId: "drums", ticks: 0 },
      { piece: "snare" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("section_not_found");
  });

  it("refuses a tick past the end of the section", () => {
    expect(landOn(SAMPLE_SONG, at("drums", 1_000_000))).toBe("bar_not_found");
  });
});

describe("216. drum hits", () => {
  const per = ticksPerSlot(SAMPLE_SONG.sections[0]!.bars[0]!.resolution);

  it("writes the first hit into a bar the track was not written in", () => {
    const legacy = withMissingKeys("drums");
    const before = canonicalJson(legacy);
    const result = insertDrumHit(legacy, at("drums", per), { piece: "snare" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barsWrittenIn(result.song, "drums")).toBe(1);
    expect(drumsAt(result.song, 0, 1).map((hit) => hit.piece)).toEqual(["snare"]);
    // The input is untouched: the lane was laid inside the candidate.
    expect(canonicalJson(legacy)).toBe(before);
  });

  it("leaves no lane behind when the hit is refused", () => {
    const legacy = withMissingKeys("drums");
    const before = canonicalJson(legacy);
    const result = insertDrumHit(legacy, at("drums", per + 1), { piece: "snare" });
    expect(result.ok).toBe(false);
    expect(barsWrittenIn(legacy, "drums")).toBe(0);
    expect(canonicalJson(legacy)).toBe(before);
  });

  it("writes into an explicitly empty lane", () => {
    const empty = structuredClone(SAMPLE_SONG) as Song;
    empty.sections[0]!.bars[0]!.slots["drums"] = (
      empty.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[]
    ).map(() => []) as Bar["slots"][string];
    const result = insertDrumHit(empty, at("drums", 0), { piece: "kick" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(drumsAt(result.song, 0, 0).map((hit) => hit.piece)).toEqual(["kick"]);
  });

  it("lets a kick and a snare share one tick", () => {
    const cleared = structuredClone(SAMPLE_SONG) as Song;
    cleared.sections[0]!.bars[0]!.slots["drums"] = (
      cleared.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[]
    ).map(() => []) as Bar["slots"][string];
    const first = insertDrumHit(cleared, at("drums", 0), { piece: "kick" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = insertDrumHit(first.song, at("drums", 0), { piece: "snare" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(drumsAt(second.song, 0, 0).map((hit) => hit.piece)).toEqual(["kick", "snare"]);
  });

  it("refuses the same piece twice at one tick", () => {
    const result = insertDrumHit(SAMPLE_SONG, at("drums", 0), { piece: "kick" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("target_occupied");
  });

  it("refuses a piece the kit does not have", () => {
    const result = insertDrumHit(SAMPLE_SONG, at("drums", per), {
      piece: "cowbell" as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unknown_drum_piece");
  });

  it("refuses a drum command aimed at a guitar", () => {
    const result = insertDrumHit(SAMPLE_SONG, at("gtr", per), { piece: "kick" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("track_not_drums");
  });

  it("takes one piece away and keeps the others", () => {
    const before = drumsAt(SAMPLE_SONG, 0, 0).map((hit) => hit.piece);
    expect(before.length).toBeGreaterThan(1);
    const result = removeDrumHit(SAMPLE_SONG, at("drums", 0), "kick");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(drumsAt(result.song, 0, 0).map((hit) => hit.piece)).toEqual(
      before.filter((piece) => piece !== "kick"),
    );
  });

  it("keeps the lane written when the last hit goes", () => {
    let song: Song = SAMPLE_SONG;
    for (const piece of drumsAt(SAMPLE_SONG, 0, 0).map((hit) => hit.piece)) {
      const result = removeDrumHit(song, at("drums", 0), piece);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      song = result.song;
    }
    expect(drumsAt(song, 0, 0)).toEqual([]);
    expect(barsWrittenIn(song, "drums")).toBe(barsWrittenIn(SAMPLE_SONG, "drums"));
  });

  it("answers what is on a beat from the song, not from anything cached", () => {
    // The toggle decides what a tap means from this, so a wrong answer here
    // is a tap that writes when it should erase (2Q-B §17, probe 14).
    const pieces = drumsAt(SAMPLE_SONG, 0, 0).map((entry) => entry.piece);
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(hitAt(SAMPLE_SONG, at("drums", 0), piece)).toBe(true);
    }
    expect(hitAt(SAMPLE_SONG, at("drums", 0), "china")).toBe(false);
    // A moment that is not on the grid carries nothing, and says so quietly.
    expect(hitAt(SAMPLE_SONG, at("drums", 1), "snare")).toBe(false);

    const removed = removeDrumHit(SAMPLE_SONG, at("drums", 0), pieces[0]!);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(hitAt(removed.song, at("drums", 0), pieces[0]!)).toBe(false);
  });

  it("drops the whole candidate when the validators refuse it", () => {
    /*
     * The velocity is outside what the contract can hold. The command builds
     * a whole candidate and hands it to `settle`; without that gate the
     * candidate would reach the reader's song (2Q-B §17, probe 23).
     */
    const result = insertDrumHit(SAMPLE_SONG, at("drums", per), {
      piece: "china",
      velocity: 999,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("validation_failed");
    expect(canonicalJson(SAMPLE_SONG)).toBe(frozen);
  });

  it("keeps the lane when the last hit on the whole track goes", () => {
    /*
     * Not just this slot: every hit on the track, so the lane is empty from
     * end to end and the temptation to tidy the key away is at its strongest
     * (2Q-B §17, probe 9).
     */
    let song: Song = SAMPLE_SONG;
    for (const [barIndex, bar] of SAMPLE_SONG.sections[0]!.bars.entries()) {
      const lane = bar.slots["drums"] as DrumSlot[];
      let ticks = 0;
      for (let index = 0; index < barIndex; index += 1) {
        ticks += (SAMPLE_SONG.sections[0]!.bars[index]!.slots["drums"] as DrumSlot[]).length * per;
      }
      for (const [slotIndex, slot] of lane.entries()) {
        for (const hit of slot) {
          const result = removeDrumHit(song, at("drums", ticks + slotIndex * per), hit.piece);
          expect(result.ok).toBe(true);
          if (result.ok) song = result.song;
        }
      }
    }
    for (const bar of song.sections[0]!.bars) {
      expect(Object.prototype.hasOwnProperty.call(bar.slots, "drums")).toBe(true);
      expect((bar.slots["drums"] as DrumSlot[]).every((slot) => slot.length === 0)).toBe(true);
    }
  });

  it("says nothing to remove when the slot is already empty", () => {
    const result = removeDrumHit(SAMPLE_SONG, at("drums", per), "china");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("nothing_to_remove");
  });

  it("carries velocity and the three levels into the sounding plan", () => {
    const cleared = structuredClone(SAMPLE_SONG) as Song;
    cleared.sections[0]!.bars[0]!.slots["drums"] = (
      cleared.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[]
    ).map(() => []) as Bar["slots"][string];
    const result = insertDrumHit(cleared, at("drums", 0), {
      piece: "snare",
      velocity: 40,
      articulation: "ghost",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(drumsAt(result.song, 0, 0)[0]).toEqual({
      piece: "snare",
      velocity: 40,
      articulation: "ghost",
    });
    const plan = buildNotatedPlan(result.song);
    const drum = plan.events.find(
      (event) => event.kind === "drum" && event.trackId === "drums",
    );
    expect(drum?.kind === "drum" ? drum.velocity : null).toBe(40);
  });

  it("writes hits in kit order however they were added", () => {
    const cleared = structuredClone(SAMPLE_SONG) as Song;
    cleared.sections[0]!.bars[0]!.slots["drums"] = (
      cleared.sections[0]!.bars[0]!.slots["drums"] as DrumSlot[]
    ).map(() => []) as Bar["slots"][string];
    const snareFirst = insertDrumHit(cleared, at("drums", 0), { piece: "snare" });
    expect(snareFirst.ok).toBe(true);
    if (!snareFirst.ok) return;
    const then = insertDrumHit(snareFirst.song, at("drums", 0), { piece: "kick" });
    expect(then.ok).toBe(true);
    if (!then.ok) return;
    expect(drumsAt(then.song, 0, 0).map((hit) => hit.piece)).toEqual(["kick", "snare"]);
  });

  it("does not mutate the song it was handed, and repeats itself", () => {
    const runs = Array.from({ length: 5 }, () =>
      insertDrumHit(SAMPLE_SONG, at("drums", per), { piece: "crash" }),
    );
    expect(canonicalJson(SAMPLE_SONG)).toBe(frozen);
    const bytes = runs.map((run) => (run.ok ? canonicalJson(run.song) : "refused"));
    expect(new Set(bytes).size).toBe(1);
  });
});

describe("217. pitched notes", () => {
  const per = ticksPerSlot(SAMPLE_SONG.sections[0]!.bars[0]!.resolution);

  it("knows a fretless melodic track from the other two kinds", () => {
    const song = withKeys();
    expect(isPitchedTrack(song.tracks.find((track) => track.id === "keys")!)).toBe(true);
    expect(isPitchedTrack(song.tracks.find((track) => track.id === "gtr")!)).toBe(false);
    expect(isPitchedTrack(song.tracks.find((track) => track.id === "drums")!)).toBe(false);
  });

  it("writes a note with no position anywhere on it", () => {
    const song = withKeys();
    const result = insertPitchedNote(song, at("keys", 0), { pitch: "C4" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = (result.song.sections[0]!.bars[0]!.slots["keys"] as unknown[])[0];
    expect(slot).toEqual({ notes: [{ pitch: "C4" }] });
    expect(canonicalJson(result.song)).not.toContain("\"position\":{\"string\"");
  });

  it("writes the first note into a bar the track was not written in", () => {
    const song = withKeys();
    const stripped = structuredClone(song) as Song;
    for (const section of stripped.sections) {
      for (const bar of section.bars) delete bar.slots["keys"];
    }
    const before = canonicalJson(stripped);
    const result = insertPitchedNote(stripped, at("keys", per), { pitch: "E4" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(barsWrittenIn(result.song, "keys")).toBe(1);
    expect(canonicalJson(stripped)).toBe(before);
  });

  it("refuses a pitch the contract cannot spell, and lays no lane", () => {
    const song = withKeys();
    const stripped = structuredClone(song) as Song;
    for (const section of stripped.sections) {
      for (const bar of section.bars) delete bar.slots["keys"];
    }
    const result = insertPitchedNote(stripped, at("keys", 0), { pitch: "H9" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("pitch_unreadable");
    expect(barsWrittenIn(stripped, "keys")).toBe(0);
  });

  it("refuses a pitched command aimed at a guitar", () => {
    const result = insertPitchedNote(SAMPLE_SONG, at("gtr", 0), { pitch: "C4" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("track_not_pitched");
  });

  it("does not overwrite an onset silently", () => {
    const song = withKeys();
    const first = insertPitchedNote(song, at("keys", 0), { pitch: "C4" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = insertPitchedNote(first.song, at("keys", 0), { pitch: "D4" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("target_occupied");
  });

  it("replaces only when the reader says so, and only that onset", () => {
    const song = withKeys();
    const first = insertPitchedNote(song, at("keys", 0), { pitch: "C4" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const neighbour = insertPitchedNote(first.song, at("keys", per), { pitch: "G4" });
    expect(neighbour.ok).toBe(true);
    if (!neighbour.ok) return;
    const replaced = insertPitchedNote(
      neighbour.song,
      at("keys", 0),
      { pitch: "D4" },
      { replace: true },
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    const lane = replaced.song.sections[0]!.bars[0]!.slots["keys"] as unknown[];
    expect(lane[0]).toEqual({ notes: [{ pitch: "D4" }] });
    expect(lane[1]).toEqual({ notes: [{ pitch: "G4" }] });
  });

  it("holds a note over several slots as ties, not as a second onset", () => {
    const song = withKeys();
    const result = insertPitchedNote(song, at("keys", 0), { pitch: "C4", slots: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lane = result.song.sections[0]!.bars[0]!.slots["keys"] as unknown[];
    expect(lane[0]).toEqual({ notes: [{ pitch: "C4" }] });
    expect(lane[1]).toBe("-");
    expect(lane[2]).toBe("-");
    expect(lane[3]).toBeNull();
  });

  it("refuses a length that would run past the bar", () => {
    const song = withKeys();
    const lane = song.sections[0]!.bars[0]!.slots["keys"] as unknown[];
    const result = insertPitchedNote(song, at("keys", 0), {
      pitch: "C4",
      slots: lane.length + 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("off_grid_target");
  });

  it("takes the ties with the onset when the note is removed", () => {
    const song = withKeys();
    const written = insertPitchedNote(song, at("keys", 0), { pitch: "C4", slots: 3 });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const removed = removePitchedNote(written.song, at("keys", 0));
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const lane = removed.song.sections[0]!.bars[0]!.slots["keys"] as unknown[];
    expect(lane.slice(0, 4)).toEqual([null, null, null, null]);
  });

  it("says nothing to remove on an empty slot", () => {
    const song = withKeys();
    const result = removePitchedNote(song, at("keys", 0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("nothing_to_remove");
  });

  it("does not mutate the song it was handed, and repeats itself", () => {
    const song = withKeys();
    const before = canonicalJson(song);
    const runs = Array.from({ length: 5 }, () =>
      insertPitchedNote(song, at("keys", per * 2), { pitch: "A4" }),
    );
    expect(canonicalJson(song)).toBe(before);
    const bytes = runs.map((run) => (run.ok ? canonicalJson(run.song) : "refused"));
    expect(new Set(bytes).size).toBe(1);
  });
});

describe("218. every refusal has a sentence a musician can act on", () => {
  it("names every code exactly once, with no diagnostic in it", () => {
    for (const [code, message] of Object.entries(EVENT_ENTRY_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(8);
      for (const banned of ["JSON", "Zod", "schema", "undefined", "Error", "trackId"]) {
        expect(message.includes(banned), `${code} → ${banned}`).toBe(false);
      }
    }
  });
});

/**
 * The section lifecycle (spec 13.17, 2L-B §6, §14).
 */
import { describe, expect, it } from "vitest";

import { worstCasePlayableSong } from "../../../eval/shared/worst-case-song";
import { songLimits } from "@/lib/limits";
import { sameSong } from "@/lib/song/edit-history";
import { survivorIndex } from "@/lib/song/lifecycle-guard";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  applySectionCommand,
  type SectionCommand,
} from "@/lib/song/section-lifecycle";
import type { Song } from "@/lib/song/schema";

const frozenSample = JSON.stringify(SAMPLE_SONG);

const CREATE: SectionCommand = {
  kind: "create_section",
  name: "Köprü",
  position: { kind: "end" },
  barCount: 2,
  timeSignature: [4, 4],
  resolution: 16,
};

const run = (song: Song, command: SectionCommand) => {
  const result = applySectionCommand(song, command);
  expect(JSON.stringify(SAMPLE_SONG)).toBe(frozenSample);
  return result;
};

describe("45. creating a section", () => {
  it("adds silent bars at the end, with no track keys invented", () => {
    const result = run(SAMPLE_SONG, CREATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.song.sections.at(-1)!;
    expect(created.name).toBe("Köprü");
    expect(created.bars).toHaveLength(2);
    for (const bar of created.bars) expect(Object.keys(bar.slots)).toEqual([]);
    expect(created.id).toBe("section-1");
  });

  it("inserts before and after a named anchor", () => {
    const before = run(SAMPLE_SONG, {
      ...CREATE,
      position: { kind: "before", sectionId: SAMPLE_SONG.sections[1]!.id },
    });
    if (before.ok) {
      expect(before.song.sections[1]?.name).toBe("Köprü");
    }
    const after = run(SAMPLE_SONG, {
      ...CREATE,
      position: { kind: "after", sectionId: SAMPLE_SONG.sections[0]!.id },
    });
    if (after.ok) {
      expect(after.song.sections[1]?.name).toBe("Köprü");
    }
    expect(before.ok && after.ok).toBe(true);
  });

  it("creates a mixed-grid section the schema can state", () => {
    const result = run(SAMPLE_SONG, {
      ...CREATE,
      timeSignature: [6, 8],
      resolution: 16,
      bpmOverride: 90,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const created = result.song.sections.at(-1)!;
      expect(created.bars[0]?.timeSignature).toEqual([6, 8]);
      expect(created.bpmOverride).toBe(90);
    }
  });

  it("refuses a meter/grid pair timing.ts cannot write", () => {
    const result = run(SAMPLE_SONG, {
      ...CREATE,
      timeSignature: [6, 8],
      resolution: 12,
    });
    expect(!result.ok && result.error.code).toBe("grid_not_representable");
  });

  it("reads its limits from the centre", () => {
    const tooMany = run(SAMPLE_SONG, {
      ...CREATE,
      barCount: songLimits.barsPerSection + 1,
    });
    expect(!tooMany.ok && tooMany.error.code).toBe("bar_count_out_of_range");

    // Fill the song to the total-bar limit, then ask for one more.
    let song: Song = SAMPLE_SONG;
    for (;;) {
      const total = song.sections.reduce((sum, s) => sum + s.bars.length, 0);
      const room = songLimits.totalBars - total;
      if (room <= 0) break;
      const next = applySectionCommand(song, {
        ...CREATE,
        barCount: Math.min(room, songLimits.barsPerSection),
      });
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      song = next.song;
    }
    const overflow = applySectionCommand(song, { ...CREATE, barCount: 1 });
    expect(!overflow.ok && overflow.error.code).toBe("song_bar_limit_reached");
  });

  it("refuses a blank name and a missing anchor", () => {
    const blank = run(SAMPLE_SONG, { ...CREATE, name: "  " });
    expect(!blank.ok && blank.error.code).toBe("invalid_section_name");
    const lost = run(SAMPLE_SONG, {
      ...CREATE,
      position: { kind: "before", sectionId: "yok" },
    });
    expect(!lost.ok && lost.error.code).toBe("section_not_found");
  });
});

describe("46. duplicating a section", () => {
  it("copies the whole bar structure and every track's content, byte-equal", () => {
    const source = SAMPLE_SONG.sections[0]!;
    const result = run(SAMPLE_SONG, {
      kind: "duplicate_section",
      sectionId: source.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = result.song.sections[1]!;
    expect(copy.id).toBe(`${source.id}-copy`);
    expect(copy.name).toBe(`${source.name} kopyası`);
    expect(sameSong(copy.bars, source.bars)).toBe(true);
    // The keys are the same keys: a bar where a track was silent stays
    // silent in the copy.
    copy.bars.forEach((bar, index) => {
      expect(Object.keys(bar.slots).sort()).toEqual(
        Object.keys(source.bars[index]!.slots).sort(),
      );
    });
  });

  it("dedupes the copy's id and name deterministically", () => {
    const once = applySectionCommand(SAMPLE_SONG, {
      kind: "duplicate_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
    });
    if (!once.ok) throw new Error("first duplicate failed");
    const twice = applySectionCommand(once.song, {
      kind: "duplicate_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
    });
    expect(twice.ok).toBe(true);
    if (twice.ok) {
      const ids = twice.song.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
      const names = twice.song.sections.map((section) => section.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("counts against the song's bar limit", () => {
    // The sample song holds 9 bars; grow a 5-bar section until duplicating
    // its biggest section would cross 32.
    let song: Song = SAMPLE_SONG;
    for (;;) {
      const total = song.sections.reduce((sum, s) => sum + s.bars.length, 0);
      const biggest = [...song.sections].sort(
        (a, b) => b.bars.length - a.bars.length,
      )[0]!;
      if (total + biggest.bars.length > songLimits.totalBars) {
        const result = applySectionCommand(song, {
          kind: "duplicate_section",
          sectionId: biggest.id,
        });
        expect(!result.ok && result.error.code).toBe("song_bar_limit_reached");
        return;
      }
      const grown = applySectionCommand(song, {
        kind: "duplicate_section",
        sectionId: biggest.id,
      });
      expect(grown.ok).toBe(true);
      if (!grown.ok) return;
      song = grown.song;
    }
  });
});

describe("47. rename, reorder, tempo, delete", () => {
  it("renames without touching anything else", () => {
    const result = run(SAMPLE_SONG, {
      kind: "rename_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
      name: "Açılış",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.song.sections[0]?.name).toBe("Açılış");
      expect(result.song.sections[0]?.id).toBe(SAMPLE_SONG.sections[0]!.id);
      expect(sameSong(result.song.sections[0]?.bars, SAMPLE_SONG.sections[0]!.bars)).toBe(true);
    }
  });

  it("reorders without changing a single id or bar", () => {
    const result = run(SAMPLE_SONG, {
      kind: "move_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
      direction: "down",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.song.sections.map((section) => section.id)).toEqual(
        [SAMPLE_SONG.sections[1]!.id, SAMPLE_SONG.sections[0]!.id],
      );
      expect(sameSong(result.song.sections[1], SAMPLE_SONG.sections[0])).toBe(true);
    }
    const stuck = run(SAMPLE_SONG, {
      kind: "move_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
      direction: "up",
    });
    expect(!stuck.ok && stuck.error.code).toBe("no_room_to_move");
  });

  it("sets and clears a tempo override, bounds from the centre", () => {
    const id = SAMPLE_SONG.sections[0]!.id;
    const set = run(SAMPLE_SONG, {
      kind: "set_section_tempo_override",
      sectionId: id,
      bpm: 90,
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.song.sections[0]?.bpmOverride).toBe(90);

    const cleared = applySectionCommand(set.song, {
      kind: "clear_section_tempo_override",
      sectionId: id,
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect("bpmOverride" in cleared.song.sections[0]!).toBe(false);
      expect(sameSong(cleared.song, SAMPLE_SONG)).toBe(true);
    }

    const wild = run(SAMPLE_SONG, {
      kind: "set_section_tempo_override",
      sectionId: id,
      bpm: 1000,
    });
    expect(!wild.ok && wild.error.code).toBe("bpm_out_of_range");
  });

  it("deletes a section but never the last one", () => {
    const result = run(SAMPLE_SONG, {
      kind: "delete_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections).toHaveLength(1);
    expect(sameSong(result.song.sections[0], SAMPLE_SONG.sections[1])).toBe(true);

    const last = applySectionCommand(result.song, {
      kind: "delete_section",
      sectionId: result.song.sections[0]!.id,
    });
    expect(!last.ok && last.error.code).toBe("last_section_undeletable");
  });

  it("warnings ride along with a success and never block (2L-B §10)", () => {
    // The heaviest supported song carries fret-jump warnings; a rename on it
    // must succeed and hand the warnings over rather than refusing.
    const warned = worstCasePlayableSong();
    const result = applySectionCommand(warned, {
      kind: "rename_section",
      sectionId: warned.sections[0]!.id,
      name: "Uyarılı Bölüm",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.song.sections[0]?.name).toBe("Uyarılı Bölüm");
    }
  });

  it("chooses the survivor deterministically: same index, else previous", () => {
    expect(survivorIndex(0, 2)).toBe(0); // deleted first of three
    expect(survivorIndex(1, 2)).toBe(1); // deleted middle of three
    expect(survivorIndex(2, 2)).toBe(1); // deleted last of three
    expect(survivorIndex(0, 1)).toBe(0);
  });
});

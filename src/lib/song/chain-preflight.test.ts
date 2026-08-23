/**
 * The chain decision, and the rule that there is no default (spec 13.20 §2).
 *
 * Two things are being pinned here, and the second matters more than the first:
 *
 * 1. The preflight names what a range would cut, honestly — including saying
 *    "nothing" when a hammer-on has no note behind it to lean on.
 * 2. **The core refuses without a decision.** Not the sheet, not the hook —
 *    `applyTransform` and `copySelection` themselves. A guard that lived only
 *    in the UI would be one direct call away from the old silent expansion.
 *
 * The most dangerous regression this file exists to catch is a preview that
 * says "only the chord" while the commit moves the whole run, so preview and
 * commit are compared directly rather than assumed to agree.
 */
import { describe, expect, it } from "vitest";

import { chainImpact } from "@/lib/song/chain-preflight";
import { applyTransform, commitTransform, copySelection } from "@/lib/song/transform";
import { ticksPerSlot } from "@/lib/music/timing";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import { bar, emptyBar, readBar, REST, slots, song, TIE, TRACK_ID } from "@/test/move-fixtures";

const STEP = ticksPerSlot(8);
const BAR = STEP * 8;

const select = (startTicks: number, endTicks: number, sectionId = "s1") => ({
  sectionId,
  trackId: TRACK_ID,
  startTicks,
  endTicks,
});

const struck = (pitch: string, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string: 1, fret } }],
});

const hammered = (pitch: string, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string: 1, fret }, articulation: "hammer_on" as const }],
});

/** A run of three, each hammered onto the one before it. */
const chainOfThree = (): Song =>
  song([
    bar(slots([struck("A3", 12), hammered("B3", 14), hammered("C4", 15), REST])),
  ]);

const impactOf = (target: Song, from: number, to: number) => {
  const impact = chainImpact(target, select(from, to));
  if (!impact) throw new Error("no impact");
  return impact;
};

describe("85. what the preflight sees", () => {
  it("says nothing is crossed when nothing is", () => {
    const target = song([bar(slots([struck("A3", 12), REST, struck("C4", 15), REST]))]);
    const impact = impactOf(target, 0, STEP);
    expect(impact.kind).toBe("no_chain_impact");
    expect(impact.boundaries).toEqual([]);
    expect(impact.detach).toEqual([]);
    // Nothing to grow to, so the widened range is the range.
    expect(impact.expanded).toEqual(impact.selection);
  });

  it("names a legato bond at each end of a range in the middle of a run", () => {
    const impact = impactOf(chainOfThree(), STEP, STEP * 2);
    expect(impact.kind).toBe("crosses_legato_boundary");
    expect(impact.boundaries.map((entry) => entry.side).sort()).toEqual(["end", "start"]);
    expect(impact.boundaries.every((entry) => entry.kind === "legato")).toBe(true);
    // Widening reaches the whole run, in both directions.
    expect(impact.expanded.startTicks).toBe(0);
    expect(impact.expanded.endTicks).toBe(STEP * 3);
  });

  it("names a tie when a held note is cut", () => {
    const target = song([bar(slots([struck("A3", 12), TIE, TIE, REST]))]);
    const impact = impactOf(target, 0, STEP);
    expect(impact.kind).toBe("crosses_tie_boundary");
    expect(impact.expanded.endTicks).toBe(STEP * 3);
  });

  it("says 'multiple' only when both kinds are involved", () => {
    /*
     * Two legato bonds — one at each end — stay `crosses_legato_boundary`.
     * That is the commonest case there is, and naming it after the number of
     * edges would leave the legato code firing almost never.
     */
    const target = song([
      bar(slots([struck("A3", 12), TIE, hammered("B3", 14), hammered("C4", 15), REST])),
    ]);
    const both = impactOf(target, STEP, STEP * 3);
    expect(both.kind).toBe("crosses_multiple_boundaries");
    expect(new Set(both.boundaries.map((entry) => entry.kind))).toEqual(
      new Set(["tie", "legato"]),
    );
  });

  it("does not invent a bond a hammer-on does not have", () => {
    // A hammer-on over a rest is a note that will be played plainly; the
    // validator already says so. Asking the reader to decide about it would
    // be asking about something that is not there.
    const target = song([bar(slots([REST, hammered("B3", 14), REST, REST]))]);
    expect(impactOf(target, STEP, STEP * 2).kind).toBe("no_chain_impact");
  });

  it("does not invent a bond across strings", () => {
    // The note before is sounding, but on another string, so nothing is being
    // hammered onto it.
    const other: MelodicSlot = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const target = song([bar(slots([other, hammered("B3", 14), REST, REST]))]);
    expect(impactOf(target, STEP, STEP * 2).kind).toBe("no_chain_impact");
  });

  it("knows a range that begins on a tie rather than on its strike", () => {
    const target = song([bar(slots([struck("A3", 12), TIE, TIE, REST]))]);
    expect(impactOf(target, STEP, STEP * 2).startsInsideTie).toBe(true);
    expect(impactOf(target, 0, STEP * 3).startsInsideTie).toBe(false);
  });

  it("reports a tie that runs on into the next section separately", () => {
    // Neither answer exists there: the range cannot be grown across a section
    // line, and detaching would edit music the reader is not looking at.
    const target = song(
      [bar(slots([...Array.from({ length: 7 }, () => REST), struck("A3", 12)]))],
      [bar(slots([TIE, REST]))],
    );
    const impact = impactOf(target, STEP * 7, BAR);
    expect(impact.kind).toBe("crosses_section_boundary");
    expect(impact.boundaries[0]?.crossesSection).toBe(true);
  });

  it("a bar the track is not written in ends a chain rather than continuing it", () => {
    const target = song([
      bar(slots([...Array.from({ length: 7 }, () => REST), struck("A3", 12)])),
      emptyBar(),
    ]);
    expect(impactOf(target, STEP * 7, BAR).kind).toBe("no_chain_impact");
  });
});

describe("86. the core refuses without a decision", () => {
  const middle = () => select(STEP, STEP * 2);

  it("refuses every command that would cut a chain", () => {
    const target = chainOfThree();
    const commands = [
      { kind: "delete_selection" } as const,
      { kind: "cut_selection" } as const,
      { kind: "duplicate_selection" } as const,
      { kind: "move_selection_time", deltaTicks: STEP * 4 } as const,
      { kind: "repeat_selection", mode: { kind: "count", count: 1 } } as const,
      { kind: "transpose_pitch", semitones: 2 } as const,
      { kind: "restring_same_pitch", stringDelta: 1 } as const,
      { kind: "translate_fret_shape", stringDelta: 0, fretDelta: 2 } as const,
      { kind: "copy_selection" } as const,
    ];

    for (const command of commands) {
      const result = applyTransform(target, middle(), command);
      expect(result.ok, command.kind).toBe(false);
      if (result.ok) continue;
      expect(result.error.code, command.kind).toBe("chain_policy_required");
    }
    // ...and the read-only path too.
    const copied = copySelection(target, middle());
    expect(copied.ok).toBe(false);
  });

  it("changes nothing when it refuses", () => {
    const target = chainOfThree();
    const before = JSON.stringify(target);
    applyTransform(target, middle(), { kind: "delete_selection" });
    expect(JSON.stringify(target)).toBe(before);
  });

  it("fails closed when the chain leaves the section", () => {
    const target = song(
      [bar(slots([...Array.from({ length: 7 }, () => REST), struck("A3", 12)]))],
      [bar(slots([TIE, REST]))],
    );
    for (const policy of ["include_chain", "detach_boundary"] as const) {
      const result = applyTransform(
        target,
        select(STEP * 7, BAR),
        { kind: "delete_selection" },
        { chainPolicy: policy },
      );
      expect(result.ok, policy).toBe(false);
      if (result.ok) continue;
      expect(result.error.code, policy).toBe("chain_crosses_section");
    }
  });

  it("lets a command with no chain around it run without being asked", () => {
    const target = song([bar(slots([struck("A3", 12), REST, REST, REST]))]);
    const result = applyTransform(target, select(0, STEP), { kind: "delete_selection" });
    expect(result.ok).toBe(true);
  });
});

describe("87. include_chain moves the whole run", () => {
  it("acts on the widened range and says so", () => {
    const target = chainOfThree();
    const result = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "delete_selection" },
      { chainPolicy: "include_chain" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All three notes of the run are gone, not just the one selected.
    expect(readBar(result.song, 0)).toEqual([".", ".", ".", ".", ".", ".", ".", "."]);
  });

  it("takes the whole held note when the range began on a tie", () => {
    const target = song([bar(slots([struck("A3", 12), TIE, TIE, REST]))]);
    const result = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "delete_selection" },
      { chainPolicy: "include_chain" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([".", ".", ".", ".", ".", ".", ".", "."]);
  });
});

describe("88. detach_boundary takes exactly what was selected", () => {
  it("removes the bond that reaches out, and keeps the ones inside", () => {
    /*
     * Two notes taken out of a run of three. The bond *between* them is theirs
     * and survives; the two that reached across the edges are removed. Written
     * as a single assertion on the whole bar so a stray articulation anywhere
     * would fail it.
     */
    const target = song([
      bar(
        slots([
          struck("A3", 12),
          hammered("B3", 14),
          hammered("C4", 15),
          hammered("D4", 17),
          REST,
        ]),
      ),
    ]);
    const result = applyTransform(
      target,
      select(STEP, STEP * 3),
      { kind: "move_selection_time", deltaTicks: STEP * 4 },
      { chainPolicy: "detach_boundary" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const moved = result.song.sections[0]?.bars[0]?.slots[TRACK_ID];
    if (!Array.isArray(moved)) throw new Error("bar not written");
    const notes = (index: number) => {
      const slot = moved[index];
      return slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    };

    // The note left behind keeps its own place and loses nothing.
    expect(notes(0)[0]?.pitch).toBe("A3");
    // The one that used to lean on the moved pair no longer does.
    expect(notes(3)[0]?.pitch).toBe("D4");
    expect(notes(3)[0]?.articulation).toBeUndefined();
    // The moved pair: the first has lost its outward bond...
    expect(notes(5)[0]?.pitch).toBe("B3");
    expect(notes(5)[0]?.articulation).toBeUndefined();
    // ...and the second keeps the bond that was inside the selection.
    expect(notes(6)[0]?.pitch).toBe("C4");
    expect(notes(6)[0]?.articulation).toBe("hammer_on");
  });

  it("never writes 'normal' in place of a removed bond", () => {
    const target = chainOfThree();
    const result = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "transpose_pitch", semitones: 0 },
      { chainPolicy: "detach_boundary" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.song)).not.toContain('"normal"');
  });

  it("leaves articulations that are not chain relations alone", () => {
    const vibrato: MelodicSlot = {
      notes: [{ pitch: "B3", position: { string: 1, fret: 14 }, articulation: "vibrato" }],
    };
    const target = song([bar(slots([struck("A3", 12), vibrato, hammered("C4", 15), REST]))]);
    const result = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "transpose_pitch", semitones: 0 },
      { chainPolicy: "detach_boundary" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID];
    if (!Array.isArray(slot)) throw new Error("bar not written");
    const note = slot[1];
    expect(note && note !== "-" && !Array.isArray(note) ? note.notes[0]?.articulation : null).toBe(
      "vibrato",
    );
  });

  it("turns tie slots that would be orphaned into rests", () => {
    const target = song([bar(slots([struck("A3", 12), TIE, TIE, REST, REST, REST, REST, REST]))]);
    const result = applyTransform(
      target,
      select(0, STEP),
      { kind: "move_selection_time", deltaTicks: STEP * 5 },
      { chainPolicy: "detach_boundary" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The note moved as a one-slot note; the two ties it left are rests, not
    // a `"-"` with nothing in front of it.
    expect(readBar(result.song, 0)).toEqual([".", ".", ".", ".", ".", "A3", ".", "."]);
  });

  it("never leaves an orphan tie, whichever way the held note is handled", () => {
    /*
     * A `"-"` with nothing in front of it is not something either policy may
     * produce. Both are exercised on the same held note, and the two cases are
     * deliberately different so neither passes for the wrong reason: moving
     * with the chain has to carry the ties along and keep them headed, while
     * detaching has to leave none at all.
     */
    const held = () =>
      song([bar(slots([struck("A3", 12), TIE, TIE, REST, REST, REST, REST, REST]))]);
    const orphans = (written: readonly string[]) =>
      written.filter((token, index) => {
        if (token !== "-") return false;
        const before = written[index - 1];
        return before === undefined || before === ".";
      }).length;

    const whole = applyTransform(
      held(),
      select(0, STEP),
      { kind: "move_selection_time", deltaTicks: STEP * 4 },
      { chainPolicy: "include_chain" },
    );
    expect(whole.ok).toBe(true);
    if (!whole.ok) return;
    const carried = readBar(whole.song, 0);
    // The ties really are there — otherwise the orphan check below would be
    // true of an empty bar and would prove nothing.
    expect(carried.filter((token) => token === "-")).toHaveLength(2);
    expect(carried).toEqual([".", ".", ".", ".", "A3", "-", "-", "."]);
    expect(orphans(carried)).toBe(0);

    const alone = applyTransform(
      held(),
      select(0, STEP),
      { kind: "move_selection_time", deltaTicks: STEP * 4 },
      { chainPolicy: "detach_boundary" },
    );
    expect(alone.ok).toBe(true);
    if (!alone.ok) return;
    const cut = readBar(alone.song, 0);
    expect(cut).toEqual([".", ".", ".", ".", "A3", ".", ".", "."]);
    expect(orphans(cut)).toBe(0);
  });

  it("refuses rather than repairing a range that begins on a tie", () => {
    const target = song([bar(slots([struck("A3", 12), TIE, TIE, REST]))]);
    const result = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "delete_selection" },
      { chainPolicy: "detach_boundary" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("selection_starts_inside_tie");
  });
});

describe("89. the preview and the commit are the same act", () => {
  /*
   * The regression this checkpoint most needs to make impossible: a ghost that
   * shows "only the chord" while the commit moves the whole run. Both are
   * `applyTransform` with the same policy, so the songs they produce are
   * compared byte for byte.
   */
  const cases = [
    { kind: "delete_selection" } as const,
    { kind: "move_selection_time", deltaTicks: STEP * 4 } as const,
    { kind: "duplicate_selection" } as const,
    { kind: "transpose_pitch", semitones: 2 } as const,
  ];

  for (const policy of ["include_chain", "detach_boundary"] as const) {
    for (const command of cases) {
      it(`${command.kind} under ${policy} previews what it commits`, () => {
        const target = chainOfThree();
        const preview = applyTransform(target, select(STEP, STEP * 2), command, {
          chainPolicy: policy,
        });
        const commit = applyTransform(target, select(STEP, STEP * 2), command, {
          chainPolicy: policy,
        });
        expect(preview.ok).toBe(commit.ok);
        if (!preview.ok || !commit.ok) return;
        expect(JSON.stringify(preview.song)).toBe(JSON.stringify(commit.song));
        expect(preview.selection).toEqual(commit.selection);
      });
    }
  }

  it("reports a different scope for each policy, so the two are not the same", () => {
    // Guards the test above from passing vacuously: if both policies produced
    // the same range, comparing them would prove nothing.
    const target = chainOfThree();
    const whole = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "delete_selection" },
      { chainPolicy: "include_chain" },
    );
    const alone = applyTransform(
      target,
      select(STEP, STEP * 2),
      { kind: "delete_selection" },
      { chainPolicy: "detach_boundary" },
    );
    expect(whole.ok && alone.ok).toBe(true);
    if (!whole.ok || !alone.ok) return;
    expect(JSON.stringify(whole.song)).not.toBe(JSON.stringify(alone.song));
    expect(readBar(alone.song, 0)[0]).toBe("A3");
    expect(readBar(whole.song, 0)[0]).toBe(".");
  });
});

describe("90. copy carries no dependency it left behind", () => {
  it("strips the outward bond from the clipboard, and the source is untouched", () => {
    const target = chainOfThree();
    const before = JSON.stringify(target);
    const copied = copySelection(target, select(STEP, STEP * 2), {
      chainPolicy: "detach_boundary",
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.clipboard.events).toHaveLength(1);
    expect(copied.clipboard.events[0]?.notes[0]?.articulation).toBeUndefined();
    expect(JSON.stringify(target)).toBe(before);
  });

  it("pasting it produces no bond pointing at whatever was already there", () => {
    const target = chainOfThree();
    const copied = copySelection(target, select(STEP, STEP * 2), {
      chainPolicy: "detach_boundary",
    });
    if (!copied.ok) return;
    const pasted = applyTransform(target, select(STEP, STEP * 2), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: STEP * 5,
    });
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const slot = pasted.song.sections[0]?.bars[0]?.slots[TRACK_ID];
    if (!Array.isArray(slot)) throw new Error("bar not written");
    const landed = slot[5];
    expect(
      landed && landed !== "-" && !Array.isArray(landed) ? landed.notes[0]?.articulation : "x",
    ).toBeUndefined();
  });

  it("keeps the whole chain when that is what was asked for", () => {
    const target = chainOfThree();
    const copied = copySelection(target, select(STEP, STEP * 2), {
      chainPolicy: "include_chain",
    });
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.clipboard.events).toHaveLength(3);
    // The head of the run has nothing to lean on, so it carries no bond...
    expect(copied.clipboard.events[0]?.notes[0]?.articulation).toBeUndefined();
    // ...and the ones inside it keep theirs.
    expect(copied.clipboard.events[1]?.notes[0]?.articulation).toBe("hammer_on");
  });
});

describe("91. one decision, one write, one undo step", () => {
  /**
   * A store that records every commit, so "atomic" can be counted rather than
   * asserted. Detaching edits the song *before* the command runs, and the
   * thing being pinned here is that this is still one act: there is no state
   * in which the bonds are cut and the command has not happened.
   */
  const recordingStore = (initial: Song) => {
    const commits: Song[] = [];
    let current = initial;
    return {
      commits,
      getSnapshot: () => ({ song: current }),
      commit: (next: Song) => {
        commits.push(next);
        current = next;
        return true;
      },
    };
  };

  it("commits exactly once for a detached move", () => {
    const store = recordingStore(chainOfThree());
    const result = commitTransform(
      store,
      select(STEP, STEP * 2),
      { kind: "move_selection_time", deltaTicks: STEP * 4 },
      { chainPolicy: "detach_boundary" },
    );
    expect(result.ok).toBe(true);
    expect(store.commits).toHaveLength(1);
  });

  it("commits nothing at all when the decision is missing", () => {
    const store = recordingStore(chainOfThree());
    const result = commitTransform(store, select(STEP, STEP * 2), {
      kind: "move_selection_time",
      deltaTicks: STEP * 4,
    });
    expect(result.ok).toBe(false);
    expect(store.commits).toHaveLength(0);
  });

  it("the one commit is the whole change, so going back to the previous song is byte-equal", () => {
    /*
     * Undo restores the song that was there before the commit. Because the
     * detach and the command are one commit, that song still has its bonds:
     * there is no half-detached version to come back to.
     */
    const before = chainOfThree();
    const beforeJson = JSON.stringify(before);
    const store = recordingStore(before);
    commitTransform(
      store,
      select(STEP, STEP * 2),
      { kind: "delete_selection" },
      { chainPolicy: "detach_boundary" },
    );
    expect(store.commits).toHaveLength(1);
    expect(JSON.stringify(store.commits[0])).not.toBe(beforeJson);
    // The song the commit was made from is untouched, articulations and all.
    expect(JSON.stringify(before)).toBe(beforeJson);
  });
});

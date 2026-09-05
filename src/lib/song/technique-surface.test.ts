/**
 * The beginner-first Çalım surface (2V-D.1-C §12–§14).
 *
 * Three things are being held here, and each has a way of going wrong that a
 * screenshot would not catch:
 *
 * - **The words.** A label that says "attack" or "span" is the model leaking
 *   into the page. Every choice is walked and checked for that, and for
 *   having a sentence saying what it *does* — "Ölü nota" tells someone who
 *   already knows and nobody else.
 * - **The preview.** It must run the same command the apply runs, refusal
 *   included, and it must write nothing. Both are checked against a song that
 *   is compared byte for byte afterwards.
 * - **The scope.** A note choice lands on the note; a region choice covers
 *   the whole bar, because a hand position that stopped halfway through a bar
 *   because a tap did is not a phrase.
 */
import { describe, expect, it } from "vitest";

import {
  ATTACK_VALUES,
  choiceLabel,
  NOTHING_CHOSEN,
  noteInScope,
  PICKING_DISCLOSURE,
  PICKING_VALUES,
  previewTechnique,
  REGION_KINDS,
  regionsInScope,
  runTechnique,
  spanForRegion,
  TECHNIQUE_GROUPS,
  techniqueScope,
  techniqueSummary,
} from "@/lib/song/technique-surface";
import { AXIS_CAPABILITY } from "@/lib/music/expression-resolver";
import { pitchAt } from "@/lib/song/edit";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";

const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const BAR = 768;
const STRING = 1;

const note = (extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, STRING, 3)!,
    position: { string: STRING, fret: 3 },
    ...extra,
  }) as NoteEvent;

function song(input: { spans?: readonly TechniqueSpan[]; extra?: Partial<NoteEvent> } = {}): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [note(input.extra ?? {})] };
  lane[4] = { notes: [note()] };
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } },
          { timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: [...lane] } },
        ],
        ...(input.spans ? { techniqueSpans: [...input.spans] } : {}),
      },
    ],
  } satisfies Song);
}

const SECTION = SAMPLE_SONG.sections[0]!.id;
const cell = (barIndex = 0, slotIndex = 0) => ({
  barKey: `${SECTION}:${barIndex}`,
  slotIndex,
  stringIndex: STRING,
});

const scopeOf = (target: Song, barIndex = 0, slotIndex = 0) =>
  techniqueScope(target, TRACK, cell(barIndex, slotIndex))!;

describe("338. three questions, in the reader's words", () => {
  it("asks exactly the three a player has", () => {
    expect(TECHNIQUE_GROUPS.map((group) => group.id)).toEqual([
      "attack",
      "picking",
      "region",
    ]);
    expect(TECHNIQUE_GROUPS.map((group) => group.label)).toEqual([
      "Vuruş",
      "Pena",
      "Bölge boyunca",
    ]);
  });

  it("never shows an identifier or a unit to the reader", () => {
    const forbidden = [
      /attack/iu,
      /picking/iu,
      /\bspan\b/iu,
      /palm_mute/u,
      /let_ring/u,
      /\btick/iu,
      /\bslot\b/iu,
      /\bvelocity\b/iu,
    ];
    for (const group of TECHNIQUE_GROUPS) {
      const words = [
        group.label,
        group.question,
        group.disclosure ?? "",
        ...group.choices.flatMap((choice) => [choice.label, choice.hint]),
      ];
      for (const word of words) {
        for (const pattern of forbidden) {
          expect(pattern.test(word), `${group.id}: ${word}`).toBe(false);
        }
      }
    }
  });

  it("says what each choice does, not only what it is called", () => {
    for (const group of TECHNIQUE_GROUPS) {
      for (const choice of group.choices) {
        expect(choice.hint.length, `${group.id}/${choice.label}`).toBeGreaterThan(10);
        expect(choice.hint).not.toBe(choice.label);
      }
    }
  });

  it("opens each group with the answer that writes nothing", () => {
    /* A beginner's first tap must not be an edit. */
    for (const group of TECHNIQUE_GROUPS) {
      expect(group.choices[0]?.value, group.id).toBeNull();
    }
  });

  it("offers every value the contract has, and nothing it does not", () => {
    expect([...ATTACK_VALUES].sort()).toEqual(
      ["accent", "dead", "ghost", "natural_harmonic", "pinch_harmonic", "tapping"].sort(),
    );
    expect([...PICKING_VALUES].sort()).toEqual(["down", "up"]);
    expect([...REGION_KINDS].sort()).toEqual(["let_ring", "palm_mute"]);
  });

  it("says out loud that pena is written and not heard", () => {
    const picking = TECHNIQUE_GROUPS.find((group) => group.id === "picking")!;
    expect(picking.disclosure).toBe(PICKING_DISCLOSURE);
    expect(PICKING_DISCLOSURE).toContain("duyulmaz");
    /* And the model agrees, which is the point of saying it. */
    expect(AXIS_CAPABILITY.picking).toBe("notation_only");
  });

  it("discloses nothing about the two axes that are heard", () => {
    for (const id of ["attack", "region"] as const) {
      expect(TECHNIQUE_GROUPS.find((group) => group.id === id)?.disclosure).toBeUndefined();
    }
  });

  it("names a choice the same way in the buttons and the summary", () => {
    expect(techniqueSummary({ group: "attack", value: "accent", noteCount: 1 })).toContain(
      choiceLabel("attack", "accent").toLowerCase(),
    );
  });

  it("counts what it is about to touch", () => {
    expect(techniqueSummary({ group: "attack", value: "accent", noteCount: 3 })).toContain("3");
    expect(techniqueSummary({ group: "region", value: "palm_mute", barCount: 2 })).toContain("2");
  });
});

describe("339. what a tap stands for, and what it writes", () => {
  it("takes the note for a note question and the whole bar for a region one", () => {
    const scope = scopeOf(song(), 0, 4);
    expect(scope.targets).toEqual([{ timeTicks: 384 }]);
    expect([scope.startTicks, scope.endTicks]).toEqual([0, BAR]);
    expect(scope.barCount).toBe(1);
  });

  it("counts the bar it is actually in, not the first one", () => {
    const scope = scopeOf(song(), 1, 0);
    expect([scope.startTicks, scope.endTicks]).toEqual([BAR, BAR * 2]);
  });

  it("reads back what the note already says", () => {
    const target = song({ extra: { attack: "accent", picking: "down" } });
    const found = noteInScope(target, scopeOf(target), 0, 0);
    expect(found?.attack).toBe("accent");
    expect(found?.picking).toBe("down");
  });

  it("lists a region mark lying over the scope, and not one beside it", () => {
    const here: TechniqueSpan = {
      id: "pm1",
      kind: "palm_mute",
      trackId: TRACK,
      startTicks: 0,
      endTicks: BAR,
      stringIndices: [STRING],
    };
    const elsewhere: TechniqueSpan = { ...here, id: "pm2", stringIndices: [5] };
    const target = song({ spans: [here, elsewhere] });
    expect(regionsInScope(target, scopeOf(target)).map((one) => one.id)).toEqual(["pm1"]);
  });

  it("writes an accent on the note the reader tapped", () => {
    const before = song();
    const result = runTechnique(before, scopeOf(before), "attack", "accent")!;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteInScope(result.song, scopeOf(result.song), 0, 0)?.attack).toBe("accent");
    /* And leaves the other note of the bar alone. */
    expect(noteInScope(result.song, scopeOf(result.song, 0, 4), 4, 0)?.attack).toBeUndefined();
  });

  it("writes a region over the whole bar", () => {
    const before = song();
    const result = runTechnique(before, scopeOf(before), "region", "palm_mute")!;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = result.song.sections[0]?.techniqueSpans ?? [];
    expect(written).toHaveLength(1);
    expect([written[0]!.startTicks, written[0]!.endTicks]).toEqual([0, BAR]);
    expect(written[0]!.stringIndices).toEqual([STRING]);
  });

  it("takes a region back off when the reader picks nothing", () => {
    const before = song({
      spans: [
        {
          id: "pm1",
          kind: "palm_mute",
          trackId: TRACK,
          startTicks: 0,
          endTicks: BAR,
          stringIndices: [STRING],
        },
      ],
    });
    const result = runTechnique(before, scopeOf(before), "region", null)!;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[0]?.techniqueSpans).toBeUndefined();
    /* The notes under it are not touched. */
    expect(noteInScope(result.song, scopeOf(result.song), 0, 0)?.pitch).toBe(note().pitch);
  });

  it("builds no region from a range with nothing in it", () => {
    expect(
      spanForRegion({ kind: "palm_mute", trackId: TRACK, startTicks: 0, endTicks: 0, stringIndices: [1] }),
    ).toBeNull();
    expect(
      spanForRegion({ kind: "palm_mute", trackId: TRACK, startTicks: 0, endTicks: BAR, stringIndices: [] }),
    ).toBeNull();
  });

  it("derives a region's identity, so a redo writes the same bytes", () => {
    const args = {
      kind: "palm_mute" as const,
      trackId: TRACK,
      startTicks: 0,
      endTicks: BAR,
      stringIndices: [1],
    };
    expect(spanForRegion(args)?.id).toBe(spanForRegion(args)?.id);
    expect(spanForRegion({ ...args, startTicks: BAR, endTicks: BAR * 2 })?.id).not.toBe(
      spanForRegion(args)?.id,
    );
  });
});

describe("340. the preview, and what it costs", () => {
  it("says what will happen before it happens", () => {
    const target = song();
    expect(previewTechnique(target, scopeOf(target), "attack", "accent")).toContain("vurgulu");
  });

  it("changes nothing at all", () => {
    const target = song();
    const snapshot = JSON.stringify(target);
    for (const group of TECHNIQUE_GROUPS) {
      for (const choice of group.choices) {
        previewTechnique(target, scopeOf(target), group.id, choice.value);
      }
    }
    expect(JSON.stringify(target)).toBe(snapshot);
  });

  it("shows a refusal in the command's own words", () => {
    /*
     * A note already carrying the legacy `accent` cannot also take the new
     * one, and the reader is told to remove the old one rather than handed a
     * note that says two things. The preview says so *before* they press.
     */
    const target = song({ extra: { articulation: "accent" } });
    const shown = previewTechnique(target, scopeOf(target), "attack", "ghost");
    expect(shown).toContain("Önce onu kaldır");
  });

  it("is not calling everything a refusal", () => {
    /* The control for the test above. */
    const target = song();
    expect(previewTechnique(target, scopeOf(target), "attack", "ghost")).not.toContain(
      "Önce onu kaldır",
    );
  });

  it("asks for a note when there is nothing to act on", () => {
    expect(previewTechnique(song(), null, "attack", "accent")).toBe(NOTHING_CHOSEN);
  });

  it("says nothing to remove where there is no region", () => {
    const target = song();
    expect(previewTechnique(target, scopeOf(target), "region", null)).toBe(NOTHING_CHOSEN);
  });

  it("agrees with the apply, choice for choice", () => {
    /*
     * The one invariant that makes a preview worth having: for every choice,
     * the sentence shown and the command run come from the same call. A
     * preview that said "ready" where the apply refuses is the failure this
     * whole arrangement exists to prevent.
     */
    const target = song({ extra: { articulation: "accent" } });
    const scope = scopeOf(target);
    let refusals = 0;
    let successes = 0;

    for (const group of TECHNIQUE_GROUPS) {
      for (const choice of group.choices) {
        const shown = previewTechnique(target, scope, group.id, choice.value);
        const result = runTechnique(target, scope, group.id, choice.value);

        if (result === null) {
          expect(shown, `${group.id}/${choice.label}`).toBe(NOTHING_CHOSEN);
          refusals += 1;
          continue;
        }
        if (!result.ok) {
          /* Word for word, not "some refusal text". */
          expect(shown, `${group.id}/${choice.label}`).toBe(result.message);
          refusals += 1;
          continue;
        }
        /* A success reads as the summary, which names the choice. */
        expect(shown, `${group.id}/${choice.label}`).not.toBe(NOTHING_CHOSEN);
        expect(shown.toLowerCase(), `${group.id}/${choice.label}`).toContain(
          choiceLabel(group.id, choice.value).toLowerCase(),
        );
        successes += 1;
      }
    }

    /* Non-vacuity: this fixture really does produce both outcomes. */
    expect(refusals).toBeGreaterThan(0);
    expect(successes).toBeGreaterThan(0);
  });
});

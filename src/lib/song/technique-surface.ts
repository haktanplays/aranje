/**
 * "Çalım": the three questions a beginner actually has (2V-D.1-C §12–§14).
 *
 * The model now separates four independent things about how a note is played.
 * A reader does not think in axes. They think:
 *
 *   - how hard did I hit it?              → **Vuruş**
 *   - which way did the pick go?          → **Pena**
 *   - is my hand doing something          → **Bölge boyunca**
 *     across this whole passage?
 *
 * So the surface is those three groups, in that order, and nothing else. The
 * order is the order of use: almost every note answers the first, some answer
 * the second, and the third is a decision about a passage rather than a note.
 *
 * ## Why the words are here and not in the component
 *
 * A label is part of the contract with the reader. Keeping it in one exported
 * table means a test can walk every choice and check that none of them is an
 * identifier, a tick or an English technique name a beginner has not met yet
 * — and that each one comes with a sentence saying what it *does*, because
 * "Ölü nota" tells someone who already knows and nobody else.
 *
 * Where a term is genuinely the word Turkish guitarists use — palm mute,
 * tapping — it stays, with the plain sentence beside it. Inventing a
 * "friendlier" name for something the reader will meet everywhere else would
 * be teaching them a word only this app speaks.
 *
 * ## Honesty about pena
 *
 * The sample bank holds one recording per pitch, so the two strokes reach the
 * speakers identically. The group carries that sentence rather than hiding
 * it: a mark the app draws and cannot play is still worth writing, and saying
 * so is the difference between notation and a claim.
 */
import {
  applyAttackWrite,
  applyPickingWrite,
  applySpanRemove,
  applySpanWrite,
  type NoteTarget,
  type TechniqueResult,
} from "@/lib/song/technique-write";
import { barOffsets } from "@/lib/song/sounding";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import type {
  NoteAttack,
  NoteEvent,
  PickingDirection,
  Song,
  TechniqueSpan,
} from "@/lib/song/schema";

export type TechniqueGroupId = "attack" | "picking" | "region";

export type TechniqueChoice = {
  /** `null` is "no answer", which removes whatever was written. */
  readonly value: string | null;
  readonly label: string;
  /** What it does, in a sentence a beginner can act on. */
  readonly hint: string;
};

export type TechniqueGroup = {
  readonly id: TechniqueGroupId;
  readonly label: string;
  /** The question the group answers, in the reader's words. */
  readonly question: string;
  readonly choices: readonly TechniqueChoice[];
  /** Said under the group when it cannot do what it looks like it does. */
  readonly disclosure?: string;
};

/** What a pena mark is and is not. Said here, and again beside export. */
export const PICKING_DISCLOSURE =
  "Pena yönü nota üzerinde yazılır ve çalarken duyulmaz: elindeki hareketi " +
  "not eder, sesi değiştirmez.";

export const TECHNIQUE_GROUPS: readonly TechniqueGroup[] = [
  {
    id: "attack",
    label: "Vuruş",
    question: "Bu notaya nasıl vurdun?",
    choices: [
      { value: null, label: "Normal", hint: "Özel bir şey yok." },
      { value: "accent", label: "Vurgulu", hint: "Diğerlerinden daha sert, öne çıkar." },
      { value: "ghost", label: "Hayalet", hint: "Çok hafif; duyulur ama öne çıkmaz." },
      { value: "dead", label: "Ölü nota", hint: "Perde basmadan, sadece tıkırtı." },
      { value: "tapping", label: "Tapping", hint: "Pena yerine parmakla klavyeye vurursun." },
      {
        value: "natural_harmonic",
        label: "Doğal armonik",
        hint: "Teli perdenin tam üstünde okşayınca çıkan ince çan sesi.",
      },
      {
        value: "pinch_harmonic",
        label: "Pinch armonik",
        hint: "Penayla birlikte baş parmağın da tele değer; cırlak bir ses.",
      },
    ],
  },
  {
    id: "picking",
    label: "Pena",
    question: "Pena hangi yöne gitti?",
    choices: [
      { value: null, label: "Belirtme", hint: "Yön yazılmaz." },
      { value: "down", label: "Aşağı", hint: "Kalın telden inceye doğru." },
      { value: "up", label: "Yukarı", hint: "İnce telden kalına doğru." },
    ],
    disclosure: PICKING_DISCLOSURE,
  },
  {
    id: "region",
    label: "Bölge boyunca",
    question: "Elin bu bölüm boyunca ne yapıyor?",
    choices: [
      { value: null, label: "Bir şey yok", hint: "Bu aralıkta özel bir el hareketi yok." },
      {
        value: "palm_mute",
        label: "Avuç susturma",
        hint: "Avucun köprüye yaslanır; sesler kısalır ve boğuklaşır.",
      },
      {
        value: "let_ring",
        label: "Çınlamaya bırak",
        hint: "Notaları susturmazsın; üst üste binerek çınlarlar.",
      },
    ],
  },
];

const GROUP = new Map(TECHNIQUE_GROUPS.map((group) => [group.id, group]));

export function techniqueGroup(id: TechniqueGroupId): TechniqueGroup {
  return GROUP.get(id)!;
}

/** The label for one choice, or the group's "no answer" label. */
export function choiceLabel(id: TechniqueGroupId, value: string | null): string {
  const found = techniqueGroup(id).choices.find((choice) => choice.value === value);
  return found?.label ?? techniqueGroup(id).choices[0]!.label;
}

export const ATTACK_VALUES: readonly NoteAttack[] = TECHNIQUE_GROUPS[0]!.choices
  .map((choice) => choice.value)
  .filter((value): value is NoteAttack => value !== null);

export const PICKING_VALUES: readonly PickingDirection[] = TECHNIQUE_GROUPS[1]!.choices
  .map((choice) => choice.value)
  .filter((value): value is PickingDirection => value !== null);

export const REGION_KINDS: readonly TechniqueSpan["kind"][] = TECHNIQUE_GROUPS[2]!.choices
  .map((choice) => choice.value)
  .filter((value): value is TechniqueSpan["kind"] => value !== null);

/**
 * What the reader is about to do, in one sentence.
 *
 * Built from the same table the buttons come from, so the preview and the
 * button can never say different things about one choice.
 */
export function techniqueSummary(input: {
  readonly group: TechniqueGroupId;
  readonly value: string | null;
  /** How many notes it lands on, for the two note-scoped groups. */
  readonly noteCount?: number;
  /** How many bars it covers, for the region group. */
  readonly barCount?: number;
}): string {
  const label = choiceLabel(input.group, input.value);
  if (input.group === "region") {
    const bars = input.barCount ?? 0;
    if (input.value === null) return "Bu aralıktaki çalım işareti kaldırılacak.";
    return bars === 1 ? `1 ölçü boyunca ${label.toLowerCase()}.` : `${bars} ölçü boyunca ${label.toLowerCase()}.`;
  }
  const notes = input.noteCount ?? 0;
  if (input.value === null) {
    return notes === 1 ? "Bu notadaki işaret kaldırılacak." : `${notes} notadaki işaret kaldırılacak.`;
  }
  return notes === 1 ? `Bu nota: ${label.toLowerCase()}.` : `${notes} nota: ${label.toLowerCase()}.`;
}

/**
 * The span a region choice writes over a selection.
 *
 * Pure and total: it decides the geometry and nothing about whether the song
 * will accept it. `applySpanWrite` is still the authority on conflicts, and
 * an id derived from the scope rather than generated keeps a redo byte-exact.
 */
export function spanForRegion(input: {
  readonly kind: TechniqueSpan["kind"];
  readonly trackId: string;
  readonly startTicks: number;
  readonly endTicks: number;
  readonly stringIndices: readonly number[];
  /** Set when the reader is editing a span that is already there. */
  readonly id?: string;
}): TechniqueSpan | null {
  if (input.endTicks <= input.startTicks) return null;
  if (input.stringIndices.length === 0) return null;
  const strings = [...new Set(input.stringIndices)].sort((a, b) => a - b);
  return {
    id: input.id ?? `${input.kind}@${input.trackId}:${input.startTicks}-${input.endTicks}`,
    kind: input.kind,
    trackId: input.trackId,
    startTicks: input.startTicks,
    endTicks: input.endTicks,
    stringIndices: strings,
  };
}


// ------------------------------------------------- binding it to a song

/**
 * What one Çalım choice will land on.
 *
 * Pure, and deliberately outside the controller: the React layer holds the
 * error string and nothing else, so every decision here is reachable from a
 * test without a component. It is also why this lives beside the write
 * commands rather than in `lib/workspace` — a controller may own a pure
 * module, and this is one.
 */
export type TechniqueScope = {
  readonly sectionId: string;
  readonly trackId: string;
  readonly stringIndex: number;
  readonly targets: readonly NoteTarget[];
  /** The whole bars the region choice covers. */
  readonly startTicks: number;
  readonly endTicks: number;
  readonly barCount: number;
};

/** A region mark already lying over the scope. */
export type RegionHere = {
  readonly id: string;
  readonly kind: TechniqueSpan["kind"];
  /** Reads as music: what it is and how wide it goes. */
  readonly label: string;
};

const REGION_WORD: Readonly<Record<TechniqueSpan["kind"], string>> = {
  palm_mute: "Avuç susturma",
  let_ring: "Çınlamaya bırak",
};

/**
 * The scope a tapped cell stands for.
 *
 * The note groups land on the note itself; the region group covers the whole
 * bar it is in, because a hand position that started in the middle of a bar
 * because a tap did is not a phrase.
 */
export function techniqueScope(
  song: Song,
  trackId: string,
  cell: { readonly barKey: string; readonly slotIndex: number; readonly stringIndex: number },
): TechniqueScope | null {
  const [sectionId, barIndexText] = cell.barKey.split(":");
  const barIndex = Number(barIndexText);
  if (!sectionId || !Number.isInteger(barIndex)) return null;
  const section = song.sections.find((entry) => entry.id === sectionId);
  const bar = section?.bars[barIndex];
  if (!section || !bar) return null;

  const barStart = barOffsets(section.bars)[barIndex] ?? 0;
  const step = ticksPerSlot(bar.resolution);
  const barLength = slotCount(bar.timeSignature, bar.resolution) * step;

  return {
    sectionId,
    trackId,
    stringIndex: cell.stringIndex,
    targets: [{ timeTicks: barStart + cell.slotIndex * step }],
    startTicks: barStart,
    endTicks: barStart + barLength,
    barCount: 1,
  };
}

/** The note under the scope, as the song currently has it. */
export function noteInScope(
  song: Song,
  scope: TechniqueScope,
  slotIndex: number,
  barIndex: number,
): NoteEvent | null {
  const section = song.sections.find((entry) => entry.id === scope.sectionId);
  const slots = section?.bars[barIndex]?.slots[scope.trackId];
  if (!Array.isArray(slots)) return null;
  const slot = slots[slotIndex];
  if (!slot || slot === "-" || Array.isArray(slot)) return null;
  return slot.notes.find((entry) => entry.position?.string === scope.stringIndex) ?? null;
}

/** The region marks over this scope, in the order they are written. */
export function regionsInScope(song: Song, scope: TechniqueScope): readonly RegionHere[] {
  const section = song.sections.find((entry) => entry.id === scope.sectionId);
  return (section?.techniqueSpans ?? [])
    .filter(
      (span) =>
        span.trackId === scope.trackId &&
        span.startTicks < scope.endTicks &&
        span.endTicks > scope.startTicks &&
        span.stringIndices.includes(scope.stringIndex),
    )
    .map((span) => ({
      id: span.id,
      kind: span.kind,
      label: `${REGION_WORD[span.kind]} · ${span.stringIndices.length} tel`,
    }));
}

/**
 * One choice, as a command against the song.
 *
 * The single place a Çalım choice becomes an edit, so the preview and the
 * apply cannot disagree — including about a refusal, which is when a preview
 * matters most. It returns a candidate song and writes nothing itself.
 */
export function runTechnique(
  song: Song,
  scope: TechniqueScope,
  group: TechniqueGroupId,
  value: string | null,
): TechniqueResult | null {
  if (group === "attack") {
    return applyAttackWrite(song, {
      sectionId: scope.sectionId,
      trackId: scope.trackId,
      targets: scope.targets,
      attack: value as NoteAttack | null,
    });
  }
  if (group === "picking") {
    return applyPickingWrite(song, {
      sectionId: scope.sectionId,
      trackId: scope.trackId,
      targets: scope.targets,
      picking: value as PickingDirection | null,
    });
  }
  if (value === null) {
    const first = regionsInScope(song, scope)[0];
    if (!first) return null;
    return applySpanRemove(song, { sectionId: scope.sectionId, spanId: first.id });
  }
  const span = spanForRegion({
    kind: value as TechniqueSpan["kind"],
    trackId: scope.trackId,
    startTicks: scope.startTicks,
    endTicks: scope.endTicks,
    stringIndices: [scope.stringIndex],
  });
  if (!span) return null;
  return applySpanWrite(song, { sectionId: scope.sectionId, span });
}

/** Said when there is nothing to act on. One sentence, in one place. */
export const NOTHING_CHOSEN = "Önce bir nota seç.";

/** What a choice would do, before it does it. Never writes. */
export function previewTechnique(
  song: Song,
  scope: TechniqueScope | null,
  group: TechniqueGroupId,
  value: string | null,
): string {
  if (!scope) return NOTHING_CHOSEN;
  const result = runTechnique(song, scope, group, value);
  if (result === null) return NOTHING_CHOSEN;
  if (!result.ok) return result.message;
  return techniqueSummary({
    group,
    value,
    noteCount: scope.targets.length,
    barCount: scope.barCount,
  });
}


/**
 * The whole surface, as the sheet sees it.
 *
 * A view rather than a controller: the shape is declared here beside the
 * functions that fill it, so the component and the pure layer cannot drift.
 */
export type TechniqueSurface = {
  /** False off a fretted track, or with nothing chosen. */
  readonly available: boolean;
  readonly attack: NoteAttack | null;
  readonly picking: PickingDirection | null;
  readonly regions: readonly RegionHere[];
  readonly noteCount: number;
  readonly barCount: number;
  /** Set when the last apply was refused, in the command's own words. */
  readonly error: string | null;
  preview(group: TechniqueGroupId, value: string | null): string;
  apply(group: TechniqueGroupId, value: string | null): void;
  removeRegion(id: string): void;
};

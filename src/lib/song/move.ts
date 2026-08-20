/**
 * Moving onset blocks in time (spec 13.1, phase 2E).
 *
 * Pure, and one atomic step. The command takes a set of onset starts and one
 * direction, and either returns a whole new song with every block moved, or
 * returns a failure and nothing at all. There is deliberately no partial move
 * and no overwrite: a half-applied move is music the musician did not ask for,
 * and an overwrite silently destroys a note they can no longer see.
 *
 * The order of the work is what makes it safe:
 *
 * 1. Resolve every origin to a whole onset block (spec: an onset is the unit).
 * 2. Empty the source slots *first*, on paper. Blocks sliding into the space
 *    each other has just left is a normal, correct move, and a collision check
 *    that ran before the sources were emptied would refuse it.
 * 3. Work out every destination and check all of them.
 * 4. Only if all of them hold, build the new song, settle it through the
 *    schema and the validator chain, and hand it back for a single commit.
 *
 * A move never changes pitch, order, explicit position, velocity, articulation
 * or how long the block sounds. It changes when a block starts and nothing
 * else.
 *
 * "How long it sounds" is measured in ticks, not in slots (spec 5.5, K-34).
 * Bars no longer share a grid, so a block landing in a bar written on a
 * different one is re-notated there — one 1/16 slot becomes two 1/32 slots,
 * four 1/32 slots become one 1/8 slot — and the sound is identical. When the
 * target grid cannot write the length at all, the move is refused with
 * `target_grid_incompatible` rather than rounded to the nearest slot: a
 * rounded move puts the musician's note somewhere they did not ask for and
 * leaves them nothing to notice it by.
 */
import {
  blockContaining,
  canonicalRefs,
  findSection,
  refKey,
  sectionBarStartTicks,
  sectionOnsetBlocks,
  sectionSlotStream,
  type OnsetBlock,
  type OnsetRef,
  type SlotPosition,
} from "@/lib/song/onset-block";
import { isEditableTrack, settle, type EditFailure, type EditResult } from "@/lib/song/edit";
import { isDrumSlotArray, type MelodicSlot, type Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/** One slot left or right, or one bar back or forward. */
export type OnsetMovement =
  | "previous_slot"
  | "next_slot"
  | "previous_bar"
  | "next_bar";

export type MoveOnsetGroupCommand = {
  kind: "move_onset_group";
  sectionId: string;
  trackId: string;
  /** Onset starts. Order does not matter; duplicates are ignored. */
  origins: readonly OnsetRef[];
  movement: OnsetMovement;
  /**
   * How a bar is named back to the reader.
   *
   * The command works in bar indices inside the section, because that is what
   * a section is made of and what the validator issue paths use. The tab
   * numbers bars across the whole song, so a message that said "bar 1" about
   * the fifth bar on screen would be pointing at nothing. The caller that
   * knows both supplies the translation; the default is the section's own
   * numbering, which is right when there is nothing else to go on.
   */
  barLabel?: (barIndex: number) => string;
};

export const MOVEMENTS: readonly OnsetMovement[] = [
  "previous_slot",
  "next_slot",
  "previous_bar",
  "next_bar",
];

export type MoveResult =
  | {
      ok: true;
      song: Song;
      warnings: ValidationIssue[];
      /**
       * Where the blocks now start, canonically ordered. The screen follows
       * the selection to its new place, so a second tap moves the same music
       * again rather than something else.
       */
      origins: OnsetRef[];
    }
  | { ok: false; error: EditFailure };

function fail(message: string): MoveResult {
  return { ok: false, error: { code: "validation_failed", message } };
}

/**
 * The move cannot be expressed on the grid it would land on (spec 5.5, K-34).
 *
 * Its own code because it is the one refusal that is not about what is in the
 * way: nothing is occupied, nothing is out of range, the music simply does
 * not exist at that moment on that grid. The alternative — snapping to the
 * nearest slot — would move the musician's note somewhere they did not ask
 * for and give them no way to tell that it happened.
 */
function gridIncompatible(message: string): MoveResult {
  return { ok: false, error: { code: "target_grid_incompatible", message } };
}

type BarLabel = (barIndex: number) => string;

const SECTION_BAR_LABEL: BarLabel = (barIndex) => `bar ${barIndex + 1}`;

/** Reader-facing name of a position: bars and slots are counted from one. */
function place(label: BarLabel, ref: OnsetRef): string {
  return `${label(ref.barIndex)}, slot ${ref.slotIndex + 1}`;
}

/** Where a block lands, or why it cannot. */
type Destination =
  | { ok: true; refs: readonly OnsetRef[]; indices: readonly number[] }
  | { ok: false; message: string; grid?: true };

/** Total sounding length of a run of stream entries, in ticks. */
function ticksOf(
  stream: readonly SlotPosition[],
  indices: readonly number[],
): number {
  return indices.reduce(
    (total, index) => total + (stream[index]?.durationTicks ?? 0),
    0,
  );
}

function destinationFor(
  block: OnsetBlock,
  movement: OnsetMovement,
  stream: readonly SlotPosition[],
  barStarts: readonly number[],
  label: BarLabel,
): Destination {
  let startIndex: number;

  if (movement === "previous_slot" || movement === "next_slot") {
    startIndex = block.startIndex + (movement === "next_slot" ? 1 : -1);
  } else {
    /*
     * A bar move keeps the *moment* and changes the bar, and a moment is a
     * tick, not a slot index (spec 5.5, K-34). Slot 8 is beat three of a 1/16
     * bar and beat two of a 1/32 one, so keeping the index would silently move
     * the music to a different beat whenever the two bars differ.
     *
     * So: read the source's offset into its own bar in ticks, and look for
     * exactly that offset in the target bar. If the target's grid has no slot
     * there, the move is refused rather than rounded.
     */
    const step = movement === "next_bar" ? 1 : -1;
    const targetBar = block.start.barIndex + step;
    const source = stream[block.startIndex];
    const sourceBarStart = barStarts[block.start.barIndex];
    const targetBarStart = barStarts[targetBar];

    if (source === undefined || sourceBarStart === undefined || targetBarStart === undefined) {
      return {
        ok: false,
        message: `${place(label, block.start)} bu bölümün dışına taşınamaz.`,
      };
    }

    const offset = source.startTicks - sourceBarStart;
    const wanted = targetBarStart + offset;
    const found = stream.findIndex(
      (entry) => entry.barIndex === targetBar && entry.startTicks === wanted,
    );
    if (found < 0) {
      const neighbour = stream.some((entry) => entry.barIndex === targetBar);
      if (!neighbour) {
        return {
          ok: false,
          message: `${place(label, block.start)} bu bölümün dışına taşınamaz.`,
        };
      }
      return {
        ok: false,
        grid: true,
        message:
          `${label(targetBar)} farklı bir ritmik grid'de ve ` +
          `${place(label, block.start)} konumundaki an orada bir slota ` +
          `denk gelmiyor. En yakın slota yuvarlanmadı; taşıma yapılmadı.`,
      };
    }
    startIndex = found;
  }

  /*
   * How far the block reaches is measured in ticks, not in slots.
   *
   * A block is a struck slot plus the tie run holding it, and what the
   * musician hears is its *length in time*. Landing on a finer grid, the same
   * length is more slots; on a coarser one, fewer. So the destination run is
   * filled until it has accumulated exactly as much time as the source did —
   * which re-notates the block on the new grid without changing a note of it,
   * and which is also what catches the case where the new grid cannot express
   * the length at all (a 1/32 note has no notation in a 1/8 bar).
   */
  const wanted = ticksOf(
    stream,
    Array.from({ length: block.length }, (_, offset) => block.startIndex + offset),
  );

  const indices: number[] = [];
  const refs: OnsetRef[] = [];
  let covered = 0;
  let index = startIndex;

  while (covered < wanted) {
    const entry = index < 0 ? undefined : stream[index];
    if (!entry) {
      return {
        ok: false,
        message: `${place(label, block.start)} bu bölümün dışına taşınamaz.`,
      };
    }
    if (!entry.writable) {
      return {
        ok: false,
        message:
          `${place(label, entry)} bu track için yazılı değil, bu yüzden ` +
          `${place(label, block.start)} oraya taşınamadı.`,
      };
    }
    indices.push(index);
    refs.push({ barIndex: entry.barIndex, slotIndex: entry.slotIndex });
    covered += entry.durationTicks;
    index += 1;
  }

  if (covered !== wanted) {
    return {
      ok: false,
      grid: true,
      message:
        `${place(label, block.start)} taşınacağı yerdeki ritmik grid bu ` +
        `sesin süresini yazamıyor; süresi değişirdi, o yüzden taşıma ` +
        `yapılmadı.`,
    };
  }

  return { ok: true, refs, indices };
}

/** A `-` with nothing sounding in front of it, anywhere in the section. */
function orphanTieIn(
  stream: readonly SlotPosition[],
  slotAt: (index: number) => MelodicSlot | undefined,
): OnsetRef | null {
  let sounding = false;

  for (let index = 0; index < stream.length; index += 1) {
    const entry = stream[index];
    if (!entry) continue;
    if (!entry.writable) {
      sounding = false;
      continue;
    }
    const slot = slotAt(index);
    if (slot === null) {
      sounding = false;
      continue;
    }
    if (slot === "-") {
      if (!sounding) {
        return { barIndex: entry.barIndex, slotIndex: entry.slotIndex };
      }
      continue;
    }
    sounding = true;
  }

  return null;
}

export function applyMoveOnsetGroup(
  song: Song,
  command: MoveOnsetGroupCommand,
): MoveResult {
  const label = command.barLabel ?? SECTION_BAR_LABEL;
  const section = findSection(song, command.sectionId);
  if (!section) {
    return fail(`"${command.sectionId}" bölümü şarkıda yok.`);
  }

  const track = song.tracks.find((entry) => entry.id === command.trackId);
  if (!track) return fail(`"${command.trackId}" track'i şarkıda yok.`);
  if (!isEditableTrack(track)) {
    return fail(
      `"${track.name}" bu ekrandan düzenlenemiyor. Şimdilik yalnız akordu ` +
        `olan telli track'ler düzenlenebiliyor.`,
    );
  }

  const origins = canonicalRefs(command.origins);
  if (origins.length === 0) return fail("Taşınacak akor seçilmedi.");

  const stream = sectionSlotStream(section, command.trackId);
  const barStarts = sectionBarStartTicks(section);
  const blocks = sectionOnsetBlocks(section, command.trackId);

  // Every origin must be a real onset start. A tie or a rest is not something
  // that can be picked up on its own (spec 13.1).
  const chosen: OnsetBlock[] = [];
  for (const origin of origins) {
    const block = blockContaining(blocks, origin);
    if (!block || block.start.barIndex !== origin.barIndex || block.start.slotIndex !== origin.slotIndex) {
      return fail(`${place(label, origin)} bir akor başlangıcı değil.`);
    }
    chosen.push(block);
  }

  // Step 2: the sources are empty as far as the check is concerned, so blocks
  // may slide into the space another selected block has just left.
  const sourceIndices = new Set<number>();
  for (const block of chosen) {
    for (let offset = 0; offset < block.length; offset += 1) {
      sourceIndices.add(block.startIndex + offset);
    }
  }

  // Step 3 and 4: every destination, then every check, before anything is built.
  const claimed = new Map<number, OnsetRef>();
  const plans: { block: OnsetBlock; refs: readonly OnsetRef[]; indices: readonly number[] }[] = [];

  for (const block of chosen) {
    const destination = destinationFor(
      block,
      command.movement,
      stream,
      barStarts,
      label,
    );
    if (!destination.ok) {
      return destination.grid
        ? gridIncompatible(destination.message)
        : fail(destination.message);
    }

    for (const index of destination.indices) {
      const other = claimed.get(index);
      if (other) {
        return fail(
          `${place(label, block.start)} ile ${place(label, other)} aynı yere ` +
            `düşüyor; seçim bu yönde taşınamaz.`,
        );
      }
      claimed.set(index, block.start);

      if (sourceIndices.has(index)) continue; // freed by the selection itself

      const entry = stream[index];
      if (!entry) continue;
      const slot = entry.slot;
      if (slot === undefined || slot === null) continue; // an empty slot is free

      return fail(
        slot === "-"
          ? `${place(label, entry)} başka bir sesin uzatması; ` +
            `${place(label, block.start)} oraya taşınamaz.`
          : `${place(label, entry)} dolu; ${place(label, block.start)} oraya taşınamaz.`,
      );
    }

    plans.push({ block, refs: destination.refs, indices: destination.indices });
  }

  // Nothing has been written until here. Build the result on a copy.
  const next = structuredClone(song);
  const nextSection = findSection(next, command.sectionId);
  if (!nextSection) return fail("Bölüm kopyalanırken bulunamadı.");

  const slotsOf = (barIndex: number): MelodicSlot[] | null => {
    const slots = nextSection.bars[barIndex]?.slots[command.trackId];
    if (slots === undefined || isDrumSlotArray(slots)) return null;
    return slots as MelodicSlot[];
  };

  /** What each source slot held, read before anything is cleared. */
  const held = new Map<string, MelodicSlot>();
  for (const block of chosen) {
    const slots = slotsOf(block.start.barIndex);
    const slot = slots?.[block.start.slotIndex];
    if (slots === null || slot === undefined) {
      return fail(`${place(label, block.start)} okunamadı.`);
    }
    held.set(refKey(block.start), slot);
  }

  for (const index of sourceIndices) {
    const entry = stream[index];
    if (!entry) continue;
    const slots = slotsOf(entry.barIndex);
    if (slots) slots[entry.slotIndex] = null;
  }

  for (const plan of plans) {
    const slot = held.get(refKey(plan.block.start));
    if (slot === undefined) return fail(`${place(label, plan.block.start)} okunamadı.`);

    plan.refs.forEach((ref, offset) => {
      const slots = slotsOf(ref.barIndex);
      if (!slots) return;
      // The chord itself lands on the first slot; the rest of the block is the
      // tie run that was holding it, and it keeps exactly its length.
      slots[ref.slotIndex] = offset === 0 ? slot : "-";
    });
  }

  // A move must not leave a tie behind, and must not make one either.
  const movedStream = sectionSlotStream(nextSection, command.trackId);
  const orphan = orphanTieIn(movedStream, (index) => movedStream[index]?.slot);
  if (orphan) {
    return fail(
      `Taşıma ${place(label, orphan)} konumunda sahipsiz bir uzatma bırakırdı; ` +
        `uygulanmadı.`,
    );
  }

  const settled: EditResult = settle(next);
  if (!settled.ok) return settled;

  return {
    ok: true,
    song: settled.song,
    warnings: settled.warnings,
    origins: canonicalRefs(
      plans.map((plan) => plan.refs[0]).filter((ref): ref is OnsetRef => ref !== undefined),
    ),
  };
}

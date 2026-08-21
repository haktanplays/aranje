/**
 * What you can do to a range of bars (spec 5.4, 13.12, K-43).
 *
 * Eleven commands, one pure API, two scopes that never mix. Nothing here
 * mutates its input and nothing here writes: a command returns the song it
 * would produce, and the caller decides whether that becomes a commit.
 *
 * ## Why `track` scope is thin
 *
 * A bar range on one track *is* a span of time on one track — the same thing
 * 2I-A already selects, transforms and pastes, with mixed-grid re-expression,
 * chain policy, collision rules and validation all decided and tested. So
 * track-scope commands are expressed in terms of it rather than reimplemented
 * beside it. Two implementations of "paste content into a range" would drift,
 * and the one that drifted would be this one, because it is the newer.
 *
 * ## Why `full` scope is not
 *
 * Full scope changes the *shape* of the section: bars appear, disappear and
 * change places, and every track moves with them. There is no time-selection
 * equivalent, so this is where the real new work is — and where the rules that
 * matter are structural rather than musical:
 *
 * - a section can never reach zero bars
 * - the bar limits are the schema's, not a second opinion
 * - a bar that moves takes its metre, its grid and every track with it
 * - a blank bar carries no track keys at all, because a missing key is silence
 *   and an empty slot array is a claim that the track plays nothing there
 *   (spec 5.5) — two different statements, and only one of them is true
 *
 * ## Metadata never travels
 *
 * A clipboard holds bars. It does not hold the section they came from, its
 * name, its id or its tempo — a chorus pasted into a slow bridge plays at the
 * bridge's tempo, because tempo belongs to the section (spec 8.3, K-25) and
 * not to the bars inside it.
 */
import { songLimits } from "@/lib/limits";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { regridDrums, regridMelodic } from "@/lib/song/bar-regrid";
import {
  barSelectionLength,
  expandBarSelection,
  type BarSelection,
} from "@/lib/song/bar-selection";
import { sectionBarStartTicks } from "@/lib/song/onset-block";
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Section,
  type Song,
} from "@/lib/song/schema";
import type { Clipboard } from "@/lib/song/time-selection";
import { applyTransform, copySelection } from "@/lib/song/transform";
import type { ValidationIssue } from "@/lib/validators/types";

// --------------------------------------------------------------- clipboards

/**
 * One track's bars.
 *
 * The content is a time region, so it can be written onto any grid that can
 * express it. The bar metadata is carried for the summary and for nothing
 * else: pasting content never changes the metre or grid it lands on.
 */
export type TrackBarsClipboard = {
  readonly kind: "track_bars";
  readonly trackId: string;
  readonly barCount: number;
  readonly widthTicks: number;
  readonly region: Clipboard;
};

/** Whole bars, with every track in them and the shape they are written in. */
export type FullBarsClipboard = {
  readonly kind: "full_bars";
  readonly barCount: number;
  readonly widthTicks: number;
  /** Deep copies. A `Bar` carries no section, name, id or tempo. */
  readonly bars: readonly Bar[];
};

export type BarClipboard = TrackBarsClipboard | FullBarsClipboard;

// ----------------------------------------------------------------- commands

export type BarCommand =
  | { readonly kind: "copy_bars" }
  | { readonly kind: "cut_bars" }
  | {
      readonly kind: "paste_bar_contents";
      readonly clipboard: BarClipboard;
      /** Explicit, and never assumed: overwriting is a decision. */
      readonly replace?: boolean;
    }
  | {
      readonly kind: "insert_copied_bars";
      readonly clipboard: BarClipboard;
      readonly side: "before" | "after";
    }
  | { readonly kind: "duplicate_bars" }
  | {
      readonly kind: "repeat_bars";
      readonly mode:
        | { readonly kind: "count"; readonly count: number }
        | { readonly kind: "fill_to_section_end" };
    }
  | { readonly kind: "insert_blank_bar_before" }
  | { readonly kind: "insert_blank_bar_after" }
  | { readonly kind: "delete_bars" }
  | { readonly kind: "move_bars_left" }
  | { readonly kind: "move_bars_right" };

export type BarTransformErrorCode =
  | "section_not_found"
  | "track_not_found"
  | "selection_out_of_bounds"
  | "chain_crosses_section"
  | "clipboard_empty"
  /** A track clipboard offered to a full paste, or the other way round. */
  | "scope_mismatch"
  /** A track clipboard offered to a different track. */
  | "wrong_track"
  | "target_occupied"
  | "target_grid_incompatible"
  | "section_would_be_empty"
  | "bar_limit_reached"
  | "no_room_to_move"
  | "not_available_in_scope"
  | "transform_failed";

export type BarTransformFailure = {
  readonly code: BarTransformErrorCode;
  readonly message: string;
};

export type BarTransformResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** Where the affected bars now lie, after expansion and any reordering. */
      readonly selection: BarSelection;
      readonly warnings: readonly ValidationIssue[];
      /** Said out loud when the selection grew under the reader. */
      readonly notice: string | null;
    }
  | { readonly ok: false; readonly error: BarTransformFailure };

export type BarClipboardResult =
  | {
      readonly ok: true;
      readonly clipboard: BarClipboard;
      readonly selection: BarSelection;
      readonly notice: string | null;
    }
  | { readonly ok: false; readonly error: BarTransformFailure };

const fail = (
  code: BarTransformErrorCode,
  message: string,
): { ok: false; error: BarTransformFailure } => ({ ok: false, error: { code, message } });

// ------------------------------------------------------------------ helpers

function barWidthTicks(bar: Bar): number {
  return slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);
}

function rangeWidthTicks(section: Section, from: number, to: number): number {
  let total = 0;
  for (let index = from; index <= to; index += 1) {
    const bar = section.bars[index];
    if (bar) total += barWidthTicks(bar);
  }
  return total;
}

/** The bar range as a span of time on one track. */
function timeRange(
  section: Section,
  trackId: string,
  selection: BarSelection,
): { sectionId: string; trackId: string; startTicks: number; endTicks: number } {
  const starts = sectionBarStartTicks(section);
  const startTicks = starts[selection.startBarIndex] ?? 0;
  return {
    sectionId: selection.sectionId,
    trackId,
    startTicks,
    endTicks:
      startTicks +
      rangeWidthTicks(section, selection.startBarIndex, selection.endBarIndex),
  };
}

function sectionOf(song: Song, sectionId: string): Section | undefined {
  return song.sections.find((entry) => entry.id === sectionId);
}

function withBars(song: Song, sectionId: string, bars: readonly Bar[]): Song {
  return {
    ...song,
    sections: song.sections.map((section) =>
      section.id === sectionId ? { ...section, bars: [...bars] } : section,
    ),
  };
}

/** A deep copy, so a clipboard can outlive the song it was taken from. */
function cloneBar(bar: Bar): Bar {
  return JSON.parse(JSON.stringify(bar)) as Bar;
}

function totalBars(song: Song): number {
  return song.sections.reduce((sum, section) => sum + section.bars.length, 0);
}

/**
 * Would this many extra bars break a limit the schema enforces?
 *
 * Asked here rather than discovered at parse time, so the refusal is a
 * sentence about bars rather than a Zod diagnostic.
 */
function limitRefusal(
  song: Song,
  section: Section,
  added: number,
): { ok: false; error: BarTransformFailure } | null {
  if (section.bars.length + added > songLimits.barsPerSection) {
    return fail(
      "bar_limit_reached",
      `Bir bölüm en fazla ${songLimits.barsPerSection} ölçü taşıyabiliyor.`,
    );
  }
  if (totalBars(song) + added > songLimits.totalBars) {
    return fail(
      "bar_limit_reached",
      `Şarkı en fazla ${songLimits.totalBars} ölçü taşıyabiliyor.`,
    );
  }
  return null;
}

/** Is anything written in this bar range, on any track in scope? */
function rangeHasContent(
  section: Section,
  selection: BarSelection,
): boolean {
  for (let index = selection.startBarIndex; index <= selection.endBarIndex; index += 1) {
    const bar = section.bars[index];
    if (!bar) continue;
    const entries =
      selection.scope === "track"
        ? ([bar.slots[selection.trackId]].filter(Boolean) as (
            | MelodicSlot[]
            | DrumSlot[]
          )[])
        : Object.values(bar.slots);
    for (const slots of entries) {
      if (!slots) continue;
      if (isDrumSlotArray(slots)) {
        if (slots.some((slot) => slot.length > 0)) return true;
      } else if (slots.some((slot) => slot !== null)) {
        return true;
      }
    }
  }
  return false;
}

/** Every bar of the range emptied for one track, keeping the bars themselves. */
function clearTrackRange(
  section: Section,
  trackId: string,
  from: number,
  to: number,
): Bar[] {
  return section.bars.map((bar, index) => {
    if (index < from || index > to) return bar;
    if (bar.slots[trackId] === undefined) return bar;
    const count = slotCount(bar.timeSignature, bar.resolution);
    const slots = bar.slots[trackId];
    const emptied: MelodicSlot[] | DrumSlot[] =
      slots && isDrumSlotArray(slots)
        ? Array.from({ length: count }, () => [] as DrumSlot)
        : Array.from({ length: count }, () => null as MelodicSlot);
    return { ...bar, slots: { ...bar.slots, [trackId]: emptied } };
  });
}

/** Write one source bar's tracks into a target bar, keeping the target's shape. */
function pasteBarContents(
  source: Bar,
  target: Bar,
): { ok: true; bar: Bar } | { ok: false; error: BarTransformFailure } {
  const toCount = slotCount(target.timeSignature, target.resolution);
  const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};

  /*
   * Only the tracks the source bar actually wrote. A track the source left out
   * is silence there, and silence is absence: the target keeps no key for it
   * either, rather than gaining an empty array that claims the track plays
   * nothing (spec 5.5).
   */
  for (const [trackId, sourceSlots] of Object.entries(source.slots)) {
    if (!sourceSlots) continue;
    if (isDrumSlotArray(sourceSlots)) {
      const regridded = regridDrums(
        sourceSlots,
        source.resolution,
        target.resolution,
        toCount,
      );
      if (!regridded) {
        return fail(
          "target_grid_incompatible",
          "Kopyalanan ölçü hedef ölçünün ritim aralığına tam oturmuyor.",
        );
      }
      slots[trackId] = regridded;
      continue;
    }
    const regridded = regridMelodic(
      sourceSlots,
      source.resolution,
      target.resolution,
      toCount,
    );
    if (!regridded) {
      return fail(
        "target_grid_incompatible",
        "Kopyalanan ölçü hedef ölçünün ritim aralığına tam oturmuyor.",
      );
    }
    slots[trackId] = regridded;
  }

  // The target keeps its own metre, grid and everything else about it.
  return { ok: true, bar: { ...target, slots } };
}

/** A bar with the neighbour's shape and nothing written in it. */
function blankBarLike(bar: Bar): Bar {
  return {
    timeSignature: bar.timeSignature,
    resolution: bar.resolution,
    // No track keys at all: a missing key is silence for every track (5.5).
    slots: {},
  };
}

// ------------------------------------------------------------- track bridge

/**
 * Run a time-selection command and translate its answer back into bar terms.
 *
 * The bridge exists so the two vocabularies stay apart: the caller says
 * "these bars on this track", the core says "these ticks", and neither has to
 * learn the other's rules.
 */
function viaTimeSelection(
  song: Song,
  section: Section,
  selection: BarSelection & { scope: "track" },
  command: Parameters<typeof applyTransform>[2],
): BarTransformResult {
  const range = timeRange(section, selection.trackId, selection);
  const result = applyTransform(song, range, command);
  if (!result.ok) {
    return fail(
      result.error.code === "target_occupied"
        ? "target_occupied"
        : result.error.code === "target_grid_incompatible"
          ? "target_grid_incompatible"
          : "transform_failed",
      result.error.message,
    );
  }
  return {
    ok: true,
    song: result.song,
    selection,
    warnings: result.warnings,
    notice: null,
  };
}

// --------------------------------------------------------------------- copy

export function copyBars(
  song: Song,
  raw: BarSelection,
): BarClipboardResult {
  const expansion = expandBarSelection(song, raw);
  if (!expansion.ok) {
    return fail(expansion.error.code, expansion.error.message);
  }
  const selection = expansion.selection;
  const section = sectionOf(song, selection.sectionId);
  if (!section) return fail("section_not_found", "Bölüm bulunamadı.");

  const notice =
    expansion.grewBy > 0
      ? `Bağlantılı notalar nedeniyle seçim ${barSelectionLength(selection)} ölçüye genişletildi.`
      : null;

  if (selection.scope === "track") {
    const range = timeRange(section, selection.trackId, selection);
    const read = copySelection(song, range);
    if (!read.ok) return fail("transform_failed", read.error.message);
    return {
      ok: true,
      clipboard: {
        kind: "track_bars",
        trackId: selection.trackId,
        barCount: barSelectionLength(selection),
        widthTicks: range.endTicks - range.startTicks,
        region: read.clipboard,
      },
      selection,
      notice,
    };
  }

  const bars = section.bars
    .slice(selection.startBarIndex, selection.endBarIndex + 1)
    .map(cloneBar);
  return {
    ok: true,
    clipboard: {
      kind: "full_bars",
      barCount: bars.length,
      widthTicks: bars.reduce((sum, bar) => sum + barWidthTicks(bar), 0),
      bars,
    },
    selection,
    notice,
  };
}

// ------------------------------------------------------------------- apply

export function applyBarCommand(
  song: Song,
  raw: BarSelection,
  command: BarCommand,
): BarTransformResult {
  const expansion = expandBarSelection(song, raw);
  if (!expansion.ok) return fail(expansion.error.code, expansion.error.message);

  const selection = expansion.selection;
  const section = sectionOf(song, selection.sectionId);
  if (!section) return fail("section_not_found", "Bölüm bulunamadı.");

  const notice =
    expansion.grewBy > 0
      ? `Bağlantılı notalar nedeniyle seçim ${barSelectionLength(selection)} ölçüye genişletildi.`
      : null;

  const withNotice = (result: BarTransformResult): BarTransformResult =>
    result.ok ? { ...result, notice: result.notice ?? notice } : result;

  const length = barSelectionLength(selection);
  const { startBarIndex: start, endBarIndex: end } = selection;

  switch (command.kind) {
    // ------------------------------------------------------------ removal
    case "cut_bars":
    case "delete_bars": {
      if (selection.scope === "track") {
        // The bars stay; only this track's content goes.
        return withNotice(
          viaTimeSelection(song, section, selection, { kind: "delete_selection" }),
        );
      }
      if (section.bars.length - length < 1) {
        return fail(
          "section_would_be_empty",
          "Bir bölüm en az bir ölçü taşımalı; bu ölçülerin hepsi silinemez.",
        );
      }
      const bars = section.bars.filter(
        (_, index) => index < start || index > end,
      );
      const nextIndex = Math.min(start, bars.length - 1);
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection: { ...selection, startBarIndex: nextIndex, endBarIndex: nextIndex },
        warnings: [],
        notice,
      };
    }

    // ------------------------------------------------------- content paste
    case "paste_bar_contents": {
      const clipboard = command.clipboard;

      if (selection.scope === "track") {
        if (clipboard.kind !== "track_bars") {
          return fail(
            "scope_mismatch",
            "Panodaki içerik bütün enstrümanlara ait; tek enstrümanın ölçüsüne yapıştırılamaz.",
          );
        }
        if (clipboard.trackId !== selection.trackId) {
          return fail(
            "wrong_track",
            "Bu sürümde ölçü içeriği yalnız kopyalandığı enstrümana yapıştırılabilir.",
          );
        }
        if (clipboard.region.events.length === 0 && clipboard.widthTicks === 0) {
          return fail("clipboard_empty", "Pano boş.");
        }
        if (!command.replace && rangeHasContent(section, selection)) {
          return fail(
            "target_occupied",
            "Hedefte içerik var. Üzerine yazmak için “Yerine koy” gerekiyor.",
          );
        }
        const range = timeRange(section, selection.trackId, selection);
        // Replace clears *only this track* in *only these bars*.
        const cleared = command.replace
          ? withBars(
              song,
              selection.sectionId,
              clearTrackRange(section, selection.trackId, start, end),
            )
          : song;
        const clearedSection = sectionOf(cleared, selection.sectionId);
        if (!clearedSection) return fail("section_not_found", "Bölüm bulunamadı.");
        return withNotice(
          viaTimeSelection(cleared, clearedSection, selection, {
            kind: "paste_selection",
            clipboard: clipboard.region,
            atTicks: range.startTicks,
          }),
        );
      }

      if (clipboard.kind !== "full_bars") {
        return fail(
          "scope_mismatch",
          "Panodaki içerik tek enstrümana ait; bütün ölçünün yerine konamaz.",
        );
      }
      if (clipboard.bars.length === 0) return fail("clipboard_empty", "Pano boş.");
      if (!command.replace && rangeHasContent(section, selection)) {
        return fail(
          "target_occupied",
          "Hedefte içerik var. Üzerine yazmak için “Bütün ölçünün içeriğini değiştir” gerekiyor.",
        );
      }

      const bars = [...section.bars];
      for (let offset = 0; offset < clipboard.bars.length; offset += 1) {
        const targetIndex = start + offset;
        const target = bars[targetIndex];
        const source = clipboard.bars[offset];
        if (!target || !source) break;
        const written = pasteBarContents(source, target);
        if (!written.ok) return written;
        bars[targetIndex] = written.bar;
      }
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection,
        warnings: [],
        notice,
      };
    }

    // --------------------------------------------------- structural insert
    case "insert_copied_bars": {
      if (selection.scope !== "full") {
        return fail(
          "not_available_in_scope",
          "Ölçü eklemek bütün enstrümanları ilgilendirir; önce ölçünün tamamını seç.",
        );
      }
      const clipboard = command.clipboard;
      if (clipboard.kind !== "full_bars") {
        return fail(
          "scope_mismatch",
          "Yeni ölçü eklemek için bütün ölçünün kopyası gerekiyor.",
        );
      }
      if (clipboard.bars.length === 0) return fail("clipboard_empty", "Pano boş.");
      const refused = limitRefusal(song, section, clipboard.bars.length);
      if (refused) return refused;

      const at = command.side === "before" ? start : end + 1;
      const bars = [...section.bars];
      bars.splice(at, 0, ...clipboard.bars.map(cloneBar));
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection: {
          ...selection,
          startBarIndex: at,
          endBarIndex: at + clipboard.bars.length - 1,
        },
        warnings: [],
        notice,
      };
    }

    case "insert_blank_bar_before":
    case "insert_blank_bar_after": {
      if (selection.scope !== "full") {
        return fail(
          "not_available_in_scope",
          "Boş ölçü eklemek bütün enstrümanları ilgilendirir; önce ölçünün tamamını seç.",
        );
      }
      const refused = limitRefusal(song, section, 1);
      if (refused) return refused;

      const before = command.kind === "insert_blank_bar_before";
      const neighbour = section.bars[before ? start : end];
      if (!neighbour) return fail("selection_out_of_bounds", "Seçim bölümün dışında.");
      const at = before ? start : end + 1;
      const bars = [...section.bars];
      bars.splice(at, 0, blankBarLike(neighbour));
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection: { ...selection, startBarIndex: at, endBarIndex: at },
        warnings: [],
        notice,
      };
    }

    // ------------------------------------------------------------ multiply
    case "duplicate_bars": {
      if (selection.scope === "track") {
        return withNotice(
          viaTimeSelection(song, section, selection, { kind: "duplicate_selection" }),
        );
      }
      const refused = limitRefusal(song, section, length);
      if (refused) return refused;
      const copies = section.bars
        .slice(start, end + 1)
        .map(cloneBar);
      const bars = [...section.bars];
      bars.splice(end + 1, 0, ...copies);
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection: {
          ...selection,
          startBarIndex: end + 1,
          endBarIndex: end + copies.length,
        },
        warnings: [],
        notice,
      };
    }

    case "repeat_bars": {
      if (selection.scope === "track") {
        return withNotice(
          viaTimeSelection(song, section, selection, {
            kind: "repeat_selection",
            mode: command.mode,
          }),
        );
      }
      if (command.mode.kind === "fill_to_section_end") {
        /*
         * Deliberately absent in full scope. Every structural repeat makes the
         * section longer, so "the end of the section" moves as the command
         * runs and "fill to it" has no fixed meaning. Refusing is the honest
         * answer; guessing a bar count would be inventing an intention.
         */
        return fail(
          "not_available_in_scope",
          "Bölüm sonuna kadar tekrar, ölçü ekleyen bir işlemde belirsiz olurdu; kaç kez tekrarlanacağını seç.",
        );
      }
      const times = Math.max(1, Math.floor(command.mode.count));
      const added = length * times;
      const refused = limitRefusal(song, section, added);
      if (refused) return refused;
      const source = section.bars.slice(start, end + 1);
      const copies: Bar[] = [];
      for (let round = 0; round < times; round += 1) {
        copies.push(...source.map(cloneBar));
      }
      const bars = [...section.bars];
      bars.splice(end + 1, 0, ...copies);
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection: { ...selection, startBarIndex: end + 1, endBarIndex: end + copies.length },
        warnings: [],
        notice,
      };
    }

    // ---------------------------------------------------------------- move
    case "move_bars_left":
    case "move_bars_right": {
      const left = command.kind === "move_bars_left";

      if (selection.scope === "track") {
        const neighbourIndex = left ? start - 1 : end + 1;
        const neighbour = section.bars[neighbourIndex];
        if (!neighbour) {
          return fail(
            "no_room_to_move",
            left
              ? "Bu ölçüden önce bölüm içinde yer yok."
              : "Bu ölçüden sonra bölüm içinde yer yok.",
          );
        }
        const delta = left ? -barWidthTicks(neighbour) : barWidthTicks(neighbour);
        const moved = viaTimeSelection(song, section, selection, {
          kind: "move_selection_time",
          deltaTicks: delta,
        });
        if (!moved.ok) return moved;
        return {
          ...moved,
          selection: {
            ...selection,
            startBarIndex: left ? start - 1 : start + 1,
            endBarIndex: left ? end - 1 : end + 1,
          },
          notice: moved.notice ?? notice,
        };
      }

      const neighbourIndex = left ? start - 1 : end + 1;
      if (neighbourIndex < 0 || neighbourIndex >= section.bars.length) {
        return fail(
          "no_room_to_move",
          left
            ? "Bu ölçüden önce bölüm içinde yer yok."
            : "Bu ölçüden sonra bölüm içinde yer yok.",
        );
      }
      /*
       * A reorder, not an overwrite. The block and its neighbour swap places
       * and both keep everything they hold — nothing is written over, which is
       * why this needs no collision rule.
       */
      const block = section.bars.slice(start, end + 1);
      const rest = section.bars.filter((_, index) => index < start || index > end);
      const insertAt = left ? start - 1 : start + 1;
      const bars = [...rest];
      bars.splice(insertAt, 0, ...block);
      return {
        ok: true,
        song: withBars(song, selection.sectionId, bars),
        selection: {
          ...selection,
          startBarIndex: insertAt,
          endBarIndex: insertAt + block.length - 1,
        },
        warnings: [],
        notice,
      };
    }

    case "copy_bars":
      // Copy reads; it has no song to return. `copyBars` is its entry point.
      return fail(
        "not_available_in_scope",
        "Kopyalama şarkıyı değiştirmez; `copyBars` kullanılmalı.",
      );
  }
}

/**
 * What you can do to a range of bars (spec 5.4, 13.12, K-43).
 *
 * Eleven commands, one pure API, two scopes that never mix. Nothing here
 * mutates its input and nothing here writes: a command returns the song it
 * would produce, and the caller decides whether that becomes a commit.
 *
 * ## Both scopes work in whole bars
 *
 * The track scope was first written on top of the time selection, on the
 * reasoning that a bar range on one track *is* a span of time on one track.
 * That reasoning is true about the music and false about the data, and it
 * failed in two ways a reader meets immediately:
 *
 * - A bar where the track has no key at all is the ordinary empty bar you
 *   would paste into. To the tick machinery it is not writable, so the paste
 *   came back as "this rhythm does not fit the grid" — a sentence about a
 *   problem that did not exist.
 * - A drum lane has no tick representation there at all, so every bar
 *   operation on the drums was refused with an editor message. The arrangement
 *   draws the drum lane and offers the gesture on it, so that refusal was the
 *   app disagreeing with itself.
 *
 * So a track command now does what a full command does — read whole bars,
 * re-express them on the target's grid, write them back — restricted to one
 * key. The two scopes share `regridMelodic`/`regridDrums`, which is where the
 * rule that actually matters lives: a moment the destination grid cannot state
 * exactly is refused, never rounded (K-34).
 *
 * ## What full scope adds
 *
 * Full scope also changes the *shape* of the section: bars appear, disappear
 * and change places, and every track moves with them. Those rules are
 * structural rather than musical:
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
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type Section,
  type Song,
} from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

// --------------------------------------------------------------- clipboards

/**
 * One track's bars.
 *
 * Whole bars, carrying that track's content and nothing else — not the other
 * tracks that were in them, and not the section they came from. The metre and
 * grid travel because they are what the content is written *in*, and are what
 * lets it be re-expressed on a different grid when it lands. They are never
 * written to the destination: a paste changes what a bar says, never how it
 * counts.
 */
export type TrackBarsClipboard = {
  readonly kind: "track_bars";
  readonly trackId: string;
  readonly barCount: number;
  readonly widthTicks: number;
  /** Deep copies, each holding at most the one track's key. */
  readonly bars: readonly Bar[];
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

/**
 * Does this command change the *shape* of a section?
 *
 * Shape means how many bars the section has and which bar is which. Only a
 * full-scope command can change it — a track command rewrites what is inside
 * bars that stay exactly where they were, which is why the two scopes are
 * separate in the first place.
 *
 * The answer decides one thing outside this file: whether playback has to stop
 * before the write. A scheduler holding positions inside a bar array that is
 * about to be re-indexed is a scheduler pointing at music that is no longer
 * there, and the sound of that is a bar of someone else's riff.
 */
export function isStructuralBarCommand(
  scope: BarSelection["scope"],
  command: BarCommand,
): boolean {
  if (scope !== "full") return false;
  switch (command.kind) {
    case "copy_bars":
    // Content only: the bars keep their place, their meter and their grid.
    case "paste_bar_contents":
      return false;
    case "cut_bars":
    case "delete_bars":
    case "insert_copied_bars":
    case "duplicate_bars":
    case "repeat_bars":
    case "insert_blank_bar_before":
    case "insert_blank_bar_after":
    case "move_bars_left":
    case "move_bars_right":
      return true;
  }
}

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
): { ok: false; error: BarTransformFailure } => ({
  ok: false,
  error: { code, message },
});

// ------------------------------------------------------------------ shapes

/** How long one bar lasts, in ticks. Resolution cancels out; metre does not. */
function barWidthTicks(bar: Bar): number {
  return slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);
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

// -------------------------------------------------------------- one track

/** A bar carrying one track's content and nothing else. */
function barOfTrack(bar: Bar, trackId: string): Bar {
  const slots = bar.slots[trackId];
  return {
    timeSignature: bar.timeSignature,
    resolution: bar.resolution,
    slots:
      slots === undefined
        ? {}
        : { [trackId]: JSON.parse(JSON.stringify(slots)) as typeof slots },
  };
}

/**
 * One track's content replaced in a bar — or removed, when it is silence.
 *
 * `undefined` means the track writes nothing here, and a missing key is how
 * this format says that (spec 5.5). Writing an empty array instead would be a
 * different claim: that the track is written here and plays nothing.
 */
function withTrack(
  bar: Bar,
  trackId: string,
  slots: MelodicSlot[] | DrumSlot[] | undefined,
): Bar {
  if (slots === undefined) {
    if (bar.slots[trackId] === undefined) return bar;
    const next = { ...bar.slots };
    delete next[trackId];
    return { ...bar, slots: next };
  }
  return { ...bar, slots: { ...bar.slots, [trackId]: slots } };
}

/**
 * Re-express one bar of one track on another bar's grid.
 *
 * The single place a track paste can refuse, and it refuses for exactly one
 * reason: the destination grid cannot state one of the moments exactly. It is
 * never rounded to the nearest slot — a sixteenth-note triplet nudged onto an
 * eighth-note grid is a different rhythm, and silently playing a different
 * rhythm is worse than declining to write one (K-34).
 */
function regridTrack(
  source: Bar,
  trackId: string,
  target: Bar,
):
  | { ok: true; slots: MelodicSlot[] | DrumSlot[] | undefined }
  | { ok: false; error: BarTransformFailure } {
  const slots = source.slots[trackId];
  if (slots === undefined) return { ok: true, slots: undefined };

  const toCount = slotCount(target.timeSignature, target.resolution);
  const regridded = isDrumSlotArray(slots)
    ? regridDrums(slots, source.resolution, target.resolution, toCount)
    : regridMelodic(slots, source.resolution, target.resolution, toCount);
  if (!regridded) {
    return fail(
      "target_grid_incompatible",
      "Kopyalanan ölçü hedef ölçünün ritim aralığına tam oturmuyor.",
    );
  }
  return { ok: true, slots: regridded };
}

/**
 * Write a run of source bars into a section at `at`, on one track.
 *
 * Everything that can refuse is decided before a bar is written, so a refusal
 * leaves the section exactly as it was found.
 */
function writeTrackRun(
  bars: readonly Bar[],
  trackId: string,
  at: number,
  sources: readonly Bar[],
): { ok: true; bars: Bar[] } | { ok: false; error: BarTransformFailure } {
  if (at < 0 || at + sources.length > bars.length) {
    return fail(
      "selection_out_of_bounds",
      "Kopyalanan ölçüler bölümün sonuna sığmıyor.",
    );
  }
  const written = [...bars];
  for (let offset = 0; offset < sources.length; offset += 1) {
    const source = sources[offset];
    const target = written[at + offset];
    if (!source || !target) continue;
    const regridded = regridTrack(source, trackId, target);
    if (!regridded.ok) return regridded;
    written[at + offset] = withTrack(target, trackId, regridded.slots);
  }
  return { ok: true, bars: written };
}

/** Is anything written on this track in these bars? */
function trackRangeHasContent(
  section: Section,
  trackId: string,
  from: number,
  to: number,
): boolean {
  return rangeHasContent(section, {
    scope: "track",
    sectionId: section.id,
    trackId,
    startBarIndex: from,
    endBarIndex: to,
  });
}

/**
 * Write a track's selected bars into the bars behind them, `times` over.
 *
 * Shared by "Çoğalt" (once) and "Tekrarla" (as many as asked for), because
 * they are the same operation with a different count — and because a second
 * copy of this loop is a second place for the bounds arithmetic to be wrong.
 */
function repeatTrack(
  song: Song,
  section: Section,
  selection: BarSelection & { scope: "track" },
  times: number,
  notice: string | null,
): BarTransformResult {
  const start = selection.startBarIndex;
  const end = selection.endBarIndex;
  const length = end - start + 1;
  const at = end + 1;

  if (at + length * times > section.bars.length) {
    return fail(
      "no_room_to_move",
      "Bölümün sonunda bu kadar tekrar için yer yok.",
    );
  }
  if (trackRangeHasContent(section, selection.trackId, at, at + length * times - 1)) {
    return fail(
      "target_occupied",
      "Hedefte içerik var. Üzerine yazmak için “Yerine koy” gerekiyor.",
    );
  }

  const sources = section.bars
    .slice(start, end + 1)
    .map((bar) => barOfTrack(bar, selection.trackId));

  let bars: readonly Bar[] = section.bars;
  for (let round = 0; round < times; round += 1) {
    const written = writeTrackRun(bars, selection.trackId, at + round * length, sources);
    if (!written.ok) return written;
    bars = written.bars;
  }

  return {
    ok: true,
    song: withBars(song, selection.sectionId, bars),
    selection: { ...selection, startBarIndex: at, endBarIndex: at + length * times - 1 },
    warnings: [],
    notice,
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
    const bars = section.bars
      .slice(selection.startBarIndex, selection.endBarIndex + 1)
      .map((bar) => barOfTrack(bar, selection.trackId));
    return {
      ok: true,
      clipboard: {
        kind: "track_bars",
        trackId: selection.trackId,
        barCount: bars.length,
        widthTicks: bars.reduce((sum, bar) => sum + barWidthTicks(bar), 0),
        bars,
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

  const length = barSelectionLength(selection);
  const { startBarIndex: start, endBarIndex: end } = selection;

  switch (command.kind) {
    // ------------------------------------------------------------ removal
    case "cut_bars":
    case "delete_bars": {
      if (selection.scope === "track") {
        // The bars stay; only this track's content goes. Emptied rather than
        // removed, because the reader can see the bar is still there and the
        // next thing they do is often to write something else into it.
        return {
          ok: true,
          song: withBars(
            song,
            selection.sectionId,
            clearTrackRange(section, selection.trackId, start, end),
          ),
          selection,
          warnings: [],
          notice,
        };
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
        if (clipboard.bars.length === 0) return fail("clipboard_empty", "Pano boş.");
        if (!command.replace && rangeHasContent(section, selection)) {
          return fail(
            "target_occupied",
            "Hedefte içerik var. Üzerine yazmak için “Yerine koy” gerekiyor.",
          );
        }
        const written = writeTrackRun(
          section.bars,
          selection.trackId,
          start,
          clipboard.bars,
        );
        if (!written.ok) return written;
        return {
          ok: true,
          song: withBars(song, selection.sectionId, written.bars),
          selection,
          warnings: [],
          notice,
        };
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
        // Content only: the copy lands in the bars that are already there.
        return repeatTrack(song, section, selection, 1, notice);
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
        /*
         * The section keeps its length: a track repeat writes into bars that
         * already exist, so "to the end of the section" has a fixed meaning
         * here that it does not have in the full scope.
         */
        const room = section.bars.length - (end + 1);
        const times =
          command.mode.kind === "fill_to_section_end"
            ? Math.floor(room / length)
            : Math.max(1, Math.floor(command.mode.count));
        if (times < 1) {
          return fail(
            "no_room_to_move",
            "Bölümün sonunda tekrar için yer kalmadı.",
          );
        }
        return repeatTrack(song, section, selection, times, notice);
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
        const at = left ? start - 1 : start + 1;
        if (at < 0 || at + length > section.bars.length) {
          return fail(
            "no_room_to_move",
            left
              ? "Bu ölçüden önce bölüm içinde yer yok."
              : "Bu ölçüden sonra bölüm içinde yer yok.",
          );
        }
        /*
         * The bar the block is moving onto has to be free. A move that wrote
         * over the neighbour would lose a bar of music to a gesture that reads
         * like nudging, so it is refused rather than confirmed: "Taşı" is not
         * where an overwrite belongs.
         */
        const landing = left ? at : end + 1;
        if (trackRangeHasContent(section, selection.trackId, landing, landing)) {
          return fail(
            "target_occupied",
            "Taşınacak yerde bu enstrümanın içeriği var.",
          );
        }
        const sources = section.bars
          .slice(start, end + 1)
          .map((bar) => barOfTrack(bar, selection.trackId));
        // Vacate first, so the bar left behind is empty even when the old and
        // new ranges overlap.
        const emptied = clearTrackRange(section, selection.trackId, start, end);
        const written = writeTrackRun(emptied, selection.trackId, at, sources);
        if (!written.ok) return written;
        return {
          ok: true,
          song: withBars(song, selection.sectionId, written.bars),
          selection: {
            ...selection,
            startBarIndex: at,
            endBarIndex: at + length - 1,
          },
          warnings: [],
          notice,
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

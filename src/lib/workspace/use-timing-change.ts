"use client";

/**
 * The meter-and-rhythm sheet's state (spec 13.20 §6, 2N-A).
 *
 * One owner for both doors onto the same command — the bar action sheet's
 * "Ölçü ve ritim" and section management's "Bölümün ölçü ve ritmi". They differ
 * only in scope, so they are one sheet opened two ways rather than two sheets
 * that will drift.
 *
 * The command itself is pure and lives in `song/timing-change.ts`. This holds
 * what the reader has picked but not yet applied, turns a refusal into a
 * sentence, and commits exactly once on success. Nothing is written while the
 * sheet is open: the draft is session state, and closing it leaves the song,
 * the storage and the history untouched.
 */
import { useCallback, useMemo, useState } from "react";

import {
  RESOLUTIONS,
  readingResolution,
  type OfferedResolution,
  TIME_SIGNATURES,
  isRepresentableGrid,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import { readRhythm, type RhythmReading } from "@/lib/music/rhythm-language";
import { changeTiming, type TimingScope } from "@/lib/song/timing-change";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";

export type TimingTarget = {
  readonly sectionId: string;
  readonly scope: TimingScope;
  /** What the sheet is called: one bar, or the whole section. */
  readonly title: string;
};

export type TimingChangeHandle = {
  /** Null when the sheet is closed. */
  readonly target: TimingTarget | null;
  /** What the target is written in now, in both readings. */
  readonly current: RhythmReading | null;
  /** What the reader has picked. Starts at the current value. */
  readonly meter: TimeSignature;
  /** The grid the sheet is editing. Always an offered one (§5). */
  readonly resolution: OfferedResolution;
  /** The pick, in both readings, so the sheet can show what it would become. */
  readonly draft: RhythmReading | null;
  /** Grids this meter can actually be written on. Never a list of its own. */
  /** Offered grids only; a picker never lists a lattice (§5). */
  readonly grids: readonly OfferedResolution[];
  readonly error: string | null;
  readonly notice: string | null;
  open(target: TimingTarget): void;
  close(): void;
  chooseMeter(meter: TimeSignature): void;
  chooseResolution(resolution: OfferedResolution): void;
  /** Commit. One write, one history step, or a refusal that changes nothing. */
  apply(): boolean;
};

type Store = {
  getSnapshot(): { song: Song };
  commit(next: Song, action: HistoryAction): boolean;
};

const asMeter = (meter: readonly [number, number]) =>
  [meter[0], meter[1]] as TimeSignature;

/** The bar or section the target names, as it is written today. */
function currentOf(
  song: Song,
  target: TimingTarget | null,
): { meter: TimeSignature; resolution: Resolution } | null {
  if (!target) return null;
  const section = song.sections.find((entry) => entry.id === target.sectionId);
  if (!section) return null;
  /*
   * A section-scope sheet reads the first bar. A section whose bars disagree
   * has no single answer, and the first bar is the one the reader is looking
   * at when they open the list — showing "mixed" would be more honest still,
   * but it would also be a value they cannot choose.
   */
  const bar =
    target.scope.kind === "bar" ? section.bars[target.scope.barIndex] : section.bars[0];
  if (!bar) return null;
  return { meter: asMeter(bar.timeSignature), resolution: bar.resolution };
}

export function useTimingChange(store: Store, song: Song): TimingChangeHandle {
  const [target, setTarget] = useState<TimingTarget | null>(null);
  const [draftMeter, setDraftMeter] = useState<TimeSignature | null>(null);
  const [draftResolution, setDraftResolution] = useState<OfferedResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = useMemo(() => currentOf(song, target), [song, target]);

  const meter = draftMeter ?? current?.meter ?? asMeter(TIME_SIGNATURES[0]);
  const grids = useMemo(
    () => RESOLUTIONS.filter((entry) => isRepresentableGrid(meter, entry)),
    [meter],
  );

  /*
   * A grid the chosen meter cannot be written on is not offered and not kept:
   * switching from 4/4 to 6/8 while 1/4 is selected falls back to the first
   * grid the new meter allows rather than to a pair that cannot exist.
   */
  /* A bar on a lattice has no offered grid of its own; the sheet edits the
     grid the reader is reading (§5). */
  const wanted: OfferedResolution | undefined =
    draftResolution ??
    (current ? readingResolution({ resolution: current.resolution }) : grids[0]);
  const resolution =
    wanted !== undefined && grids.includes(wanted) ? wanted : grids[0]!;

  const open = useCallback((next: TimingTarget) => {
    setTarget(next);
    setDraftMeter(null);
    setDraftResolution(null);
    setError(null);
    setNotice(null);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setDraftMeter(null);
    setDraftResolution(null);
    setError(null);
    setNotice(null);
  }, []);

  const apply = useCallback((): boolean => {
    if (!target) return false;
    const result = changeTiming(store.getSnapshot().song, {
      sectionId: target.sectionId,
      scope: target.scope,
      timeSignature: meter,
      resolution,
    });
    if (!result.ok) {
      // A refusal touches neither the song, the storage nor the history.
      setError(result.error.message);
      setNotice(null);
      return false;
    }
    store.commit(result.song, {
      kind: "bar_timing_change",
      scope: target.scope.kind,
    });
    setNotice(
      result.warnings.length > 0
        ? "Uygulandı. Birkaç yerde el pozisyonu zorlanıyor olabilir."
        : null,
    );
    setError(null);
    setTarget(null);
    setDraftMeter(null);
    setDraftResolution(null);
    return true;
  }, [meter, resolution, store, target]);

  return {
    target,
    current: current ? readRhythm(current.meter, current.resolution) : null,
    meter,
    resolution,
    draft: target ? readRhythm(meter, resolution) : null,
    grids,
    error,
    notice,
    open,
    close,
    chooseMeter: setDraftMeter,
    chooseResolution: setDraftResolution,
    apply,
  };
}

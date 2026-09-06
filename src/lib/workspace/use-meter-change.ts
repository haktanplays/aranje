"use client";

/**
 * The metre panel's draft, and the one place it is applied (2V-D.2 §14, §17).
 *
 * ## Preview is not a second opinion
 *
 * The draft is session state and nothing else: choosing 5/8 writes nothing,
 * moves no bar line and makes no undo step. What it does is ask
 * `previewMeterChange` — which runs the *real* command and throws the result
 * away — so what the panel shows and what applying does cannot come apart.
 *
 * `apply` then runs the same command once more and keeps the result. Running
 * it twice is deliberate: the alternative is holding the previewed song in
 * state and committing it later, which is a stale song waiting to be written
 * over an edit the reader made in between.
 *
 * ## One commit, or none
 *
 * A refusal changes nothing at all — not the draft, not the song, not the
 * history — and leaves the sentence on the screen where the reader can read
 * it. That is the whole of §14's "no silent truncation": the only two
 * outcomes are the change and the explanation.
 */
import { useCallback, useMemo, useState } from "react";

import type { MeterDraft } from "@/components/workspace/shelf/MeterPanel";
import { defaultGrouping } from "@/lib/music/rhythm-profile";
import { readingResolution, type OfferedResolution } from "@/lib/music/timing";
import type { HistoryAction } from "@/lib/song/edit-history";
import {
  previewMeterChange,
  type MeterChangePreview,
} from "@/lib/song/meter-change-preview";
import type { Song } from "@/lib/song/schema";
import { changeTiming } from "@/lib/song/timing-change";

export type MeterChangeHandle = {
  /** What the target bar is written in now. */
  readonly current: MeterDraft;
  /** What the reader picked but has not applied. */
  readonly draft: MeterDraft | null;
  /** What applying would do. Null while nothing is drafted. */
  readonly preview: MeterChangePreview | null;
  choose(next: MeterDraft): void;
  cancel(): void;
  /** True when something was written. False on a refusal. */
  apply(): boolean;
};

/**
 * Which bar the panel is about: the viewed section's **first**.
 *
 * It follows navigation rather than the selection on purpose — a metre
 * belongs to a bar, so a reader can ask what a bar is written in without
 * having touched a note in it. Every other panel needs a target because every
 * other panel is about a note.
 *
 * One bar rather than the whole section because §14's preview is about the
 * bar whose line is going to move. A section-wide change is the same command
 * with a different scope, and is not what this panel offers.
 */
export function useMeterChange(options: {
  readonly song: Song;
  readonly commit: (next: Song, action: HistoryAction) => boolean;
  /** The section on screen. Its first bar is the one the panel is about. */
  readonly sectionId: string;
}): MeterChangeHandle {
  const { commit, song } = options;
  const [draft, setDraft] = useState<MeterDraft | null>(null);

  const current = useMemo((): MeterDraft => {
    const bar = song.sections.find((entry) => entry.id === options.sectionId)
      ?.bars[0];
    if (!bar) {
      return { meter: [4, 4], resolution: 16, grouping: defaultGrouping([4, 4]) };
    }
    return {
      meter: [bar.timeSignature[0], bar.timeSignature[1]] as MeterDraft["meter"],
      /* The grid the reader is *reading*, never a lattice: a picker that
         offered 1/48 would be naming a grid nobody counts (§5). */
      resolution: readingResolution(bar) as OfferedResolution,
      grouping: bar.grouping ?? defaultGrouping(bar.timeSignature),
    };
  }, [options.sectionId, song]);

  const preview = useMemo((): MeterChangePreview | null => {
    if (!draft) return null;
    return previewMeterChange(song, {
      sectionId: options.sectionId,
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: draft.meter,
      resolution: draft.resolution,
      grouping: draft.grouping,
    });
  }, [draft, options.sectionId, song]);

  const apply = useCallback((): boolean => {
    if (!draft) return false;
    const result = changeTiming(song, {
      sectionId: options.sectionId,
      scope: { kind: "bar", barIndex: 0 },
      timeSignature: draft.meter,
      resolution: draft.resolution,
      grouping: draft.grouping,
    });
    if (!result.ok) return false;
    const written = commit(result.song, {
      kind: "bar_timing_change",
      scope: "bar",
    });
    if (written) setDraft(null);
    return written;
  }, [commit, draft, options.sectionId, song]);

  return {
    current,
    draft,
    preview,
    choose: setDraft,
    cancel: () => setDraft(null),
    apply,
  };
}

"use client";

/**
 * The arrangement models the surfaces draw (2L-R composition, 2M-A room).
 *
 * Two memos and one label, kept together because they are the same thought:
 * the arrangement as it is, the arrangement a staged command would leave
 * behind, and the metre the header prints. None of them touches the store,
 * the history or the playback plan — a ghost is built and thrown away with
 * its preview.
 *
 * Extracted from the composition root so the root stays a root: it had run
 * out of budget, and compressing wiring to fit would have been the wrong
 * answer to that.
 */
import { useMemo } from "react";

import { buildArrangementModel, type ArrangementModel } from "@/lib/arrangement/model";
import { formatTimeSignature } from "@/lib/music/timing";
import type { Song } from "@/lib/song/schema";

export type ArrangementModels = {
  readonly arrangement: ArrangementModel;
  /** Null unless a bar command is staged. */
  readonly ghostArrangement: ArrangementModel | null;
  /** The song's opening metre, ready to print. */
  readonly meter: string;
};

export function useArrangementModels(input: {
  song: Song;
  previewSong: Song | null;
}): ArrangementModels {
  const { song, previewSong } = input;

  const arrangement = useMemo(() => buildArrangementModel(song), [song]);
  const ghostArrangement = useMemo(
    () => (previewSong ? buildArrangementModel(previewSong) : null),
    [previewSong],
  );

  const firstBar = song.sections[0]?.bars[0];
  return {
    arrangement,
    ghostArrangement,
    meter: firstBar ? formatTimeSignature(firstBar.timeSignature) : "",
  };
}

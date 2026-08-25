"use client";

/**
 * The intent layer's whole surface (2S-A §6-§9, §11).
 *
 * The four doors, the sheet behind whichever one is open, the brush's one
 * question and the pattern-continuation sheet. It is here rather than in the
 * composition root for the reason every other area is: the root composes, and
 * a feature that spreads its four pieces across it stops being one feature.
 *
 * It decides nothing about music. Every answer comes from `useIntentComposer`,
 * which in turn asks the pure cores; what this component owns is which door is
 * open, which is a fact about the screen and about nothing else.
 */
import { useEffect, useState } from "react";

import { ComposerDoorRow } from "@/components/workspace/ComposerDoorRow";
import { ComposerSheet } from "@/components/workspace/ComposerSheet";
import { ContinuePatternSheet } from "@/components/workspace/ContinuePatternSheet";
import { LegatoDecisionSheet } from "@/components/workspace/LegatoDecisionSheet";
import type { ComposerDoor, ComposerTool } from "@/lib/workspace/composer-tool";
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { Song, Track } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

export function ComposerArea({
  composer,
  song,
  track,
  selection,
  onOpenChordBuilder,
  onOpenRhythm,
}: {
  composer: IntentComposer;
  song: Song;
  track: Track | undefined;
  /** The time selection, which is what "this pattern" means (2S-A §9). */
  selection: TimeSelection | null;
  /** Null when there is no beat for the catalogue to open on. */
  onOpenChordBuilder: ((power: boolean) => void) | null;
  /** Null when there is no section for the grid sheet to be about. */
  onOpenRhythm: (() => void) | null;
}) {
  const [door, setDoor] = useState<ComposerDoor | null>(null);
  const { tool, beginGesture, cancelGesture } = composer;

  /*
   * A covered run is a brush gesture when the brush is what is held.
   *
   * The time selection is the one long-press-and-drag on this surface, and it
   * already owns the threshold, the flick and the scroll takeover (spec 13.1).
   * A second gesture with a second tolerance would be a second answer to one
   * finger, so the brush borrows this one rather than growing its own.
   */
  const connecting = tool.kind === "connect";
  useEffect(() => {
    if (!connecting || !selection) {
      cancelGesture();
      return;
    }
    beginGesture({
      sectionId: selection.sectionId,
      fromTicks: selection.startTicks,
      toTicks: selection.endTicks,
    });
  }, [beginGesture, cancelGesture, connecting, selection]);

  const pick = (next: ComposerTool) => {
    composer.pick(next);
    setDoor(null);
  };

  return (
    <>
      <ComposerDoorRow tool={tool} onOpen={setDoor} onRelease={composer.release} />

      {composer.refusal ? (
        <p
          data-composer-refusal
          role="alert"
          className="text-reject border-line border-t px-3 py-1 text-[11px]"
        >
          {composer.refusal}
        </p>
      ) : null}

      {door ? (
        <ComposerSheet
          open
          door={door}
          tool={tool}
          capo={track?.fretboard?.capo ?? 0}
          canWriteShapes={track?.fretboard !== undefined}
          onPick={pick}
          onClose={() => setDoor(null)}
          onOpenChordBuilder={
            onOpenChordBuilder === null
              ? null
              : (power) => {
                  setDoor(null);
                  onOpenChordBuilder(power);
                }
          }
          onOpenRhythm={
            onOpenRhythm === null
              ? null
              : () => {
                  setDoor(null);
                  onOpenRhythm();
                }
          }
        />
      ) : null}

      <LegatoDecisionSheet
        open={composer.gesture !== null}
        plan={composer.brushPlan}
        refusal={composer.refusal}
        onChoose={(choice) => composer.applyBrushChoice(choice)}
        onCancel={composer.cancelGesture}
      />

      <ContinuePatternSheet
        open={tool.kind === "continue_pattern" && selection !== null}
        song={song}
        selection={selection}
        refusal={composer.refusal}
        onApply={(mode, repeats, onOverrun) => {
          if (!selection) return;
          if (composer.continueSelection(selection, mode, repeats, onOverrun)) {
            composer.release();
          }
        }}
        onClose={composer.release}
      />
    </>
  );
}

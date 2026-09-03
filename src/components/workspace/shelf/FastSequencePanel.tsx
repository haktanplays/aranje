"use client";

/**
 * "Hızlı dizi", where a reader can reach it (2V-B.4 §5, §6, §7, §8).
 *
 * ## The seven steps, in one shelf
 *
 * Choose how many notes, type the frets, say whether they are joined, listen,
 * apply. No new sheet, no full screen, no note values, no subdivision, no
 * tick. The grid stays on the screen the whole time and the proposal is drawn
 * on it in amber, so the reader compares what they have with what they would
 * have rather than remembering one while looking at the other.
 *
 * ## Nothing is written until "Uygula"
 *
 * "Dinle" builds a **draft song** and plays that. The canonical Song, the
 * transaction ledger and the project store are all untouched until the reader
 * says yes, at which point the draft goes to `commit` once. Cancelling is not
 * an undo — there is nothing to undo, because nothing happened.
 *
 * ## The grid's answer is shown, not swallowed
 *
 * `rhythmAvailability` has three answers and all three reach the reader:
 * available runs silently; a measure too coarse offers **"Bu hareket için bu
 * bölümü sıklaştır."**; and a run no grid can hold says so in a sentence
 * instead of leaving a grey button to be interpreted.
 */
import { useMemo, useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfPrimary,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import { densityExplanationFor } from "@/lib/music/duration-language";
import {
  connectionBetween,
  planNoteSequence,
  AMBIGUOUS_CONNECTION_TEXT,
  SEQUENCE_PERFORMANCE_LABELS,
  type SequencePerformance,
  type SequenceStep,
} from "@/lib/music/note-sequence";
import {
  LOCAL_OVERRIDE_ACTION,
  LOCAL_OVERRIDE_DETAIL,
  rhythmAvailability,
} from "@/lib/music/rhythm-availability";
import { applySequenceWrite } from "@/lib/song/sequence-write";
import { measureLabel } from "@/lib/chords/chord-naming";
import type { EditTarget } from "@/lib/workspace/edit-target";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { Song } from "@/lib/song/schema";

const COUNTS = [2, 3, 4] as const;

/** How the fret boxes start, so the founder's own run is two taps away. */
const SEED_FRETS: Readonly<Record<number, readonly number[]>> = {
  2: [9, 10],
  3: [9, 10, 9],
  4: [9, 10, 9, 7],
};

export function FastSequencePanel({
  song,
  target,
  draft,
  onPropose,
  onDiscard,
  onPreview,
  onApply,
}: {
  song: Song;
  target: EditTarget;
  draft: EditDraft | null;
  onPropose: (draft: EditDraft) => void;
  onDiscard: () => void;
  /** Play a whole song through the production preview engine. */
  onPreview: (candidate: Song) => void;
  /**
   * Commit the proposal, as a value.
   *
   * The draft is handed over rather than read from state: a reader who presses
   * Uygula without pressing Dinle first has never had a draft on the screen,
   * and a `setState` in the same tick would not be visible here.
   */
  onApply: (proposal: EditDraft) => void;
}) {
  const [count, setCount] = useState<2 | 3 | 4>(3);
  const [frets, setFrets] = useState<readonly number[]>(SEED_FRETS[3]!);
  const [performance, setPerformance] = useState<SequencePerformance>("connected");
  const [overrideAccepted, setOverrideAccepted] = useState(false);

  const stringIndex = target.stringIndex ?? 0;
  const steps: SequenceStep[] = useMemo(
    () => frets.slice(0, count).map((fret) => ({ stringIndex, fret })),
    [count, frets, stringIndex],
  );

  const planned = useMemo(
    () =>
      planNoteSequence({
        startTicks: target.startTicks,
        spanTicks: target.spanTicks,
        steps,
        performance,
      }),
    [performance, steps, target.spanTicks, target.startTicks],
  );

  const availability = useMemo(
    () =>
      planned.ok
        ? rhythmAvailability({
            resolution: target.resolution as never,
            startTicks: target.startTicks,
            stepTicks: planned.plan.stepTicks,
            stepCount: planned.plan.notes.length,
            existingTicks: target.existingTicks,
          })
        : null,
    [planned, target.existingTicks, target.resolution, target.startTicks],
  );

  /**
   * The song as it would be.
   *
   * Built on every change rather than on a press, because the reader is
   * allowed to hear it at any moment and because a proposal that only exists
   * after "Dinle" cannot be drawn on the grid.
   */
  const proposal = useMemo(() => {
    if (!planned.ok) return null;
    if (availability?.state === "unavailable") return null;
    if (availability?.state === "requires_local_override" && !overrideAccepted) return null;
    const written = applySequenceWrite(song, {
      sectionId: target.sectionId,
      trackId: target.trackId,
      barIndex: target.barIndex,
      plan: planned.plan,
      allowLocalOverride: overrideAccepted,
    });
    return written.ok ? written : null;
  }, [availability, overrideAccepted, planned, song, target]);

  const refusal =
    planned.ok
      ? null
      : planned.reason === "span_too_short"
        ? "Bu alan bu kadar notaya yetmiyor; daha uzun bir yer seç."
        : planned.reason === "uneven_span"
          ? "Bu alan seçilen nota sayısına eşit bölünmüyor."
          : "Bu dizi için önce bir yer seç.";

  const stage = (): EditDraft | null => {
    if (!proposal || !planned.ok) return null;
    return {
      song: proposal.song,
      ghost: {
        sectionId: target.sectionId,
        trackId: target.trackId,
        fromTicks: target.sectionTicks,
        toTicks: target.sectionTicks + target.spanTicks,
        onsetTicks: planned.plan.notes.map(
          (note) => target.sectionTicks + (note.timeTicks - target.startTicks),
        ),
      },
      summary: `${frets.slice(0, count).join("–")} · ${measureLabel(target.barNumber)}`,
      label: "Hızlı dizi",
    };
  };

  const listen = () => {
    const next = stage();
    if (!next) return;
    onPropose(next);
    onPreview(next.song);
  };

  const setFret = (index: number, next: number) =>
    setFrets((current) => {
      const copy = [...current];
      while (copy.length < count) copy.push(0);
      copy[index] = Math.max(0, Math.min(24, next));
      return copy;
    });

  /* The grid is too coarse for this run and the reader has not yet agreed to
     make this passage denser. That agreement is the next step (§8). */
  const needsOverride =
    availability?.state === "requires_local_override" && !overrideAccepted;

  const ambiguous =
    performance === "connected" &&
    steps.some(
      (step, index) =>
        index > 0 && connectionBetween(steps[index - 1]!, step) === "ambiguous",
    );

  return (
    <div className="flex flex-col gap-2" data-panel="fast-sequence">
      <ShelfNote testId="density">{densityExplanationFor(count)}</ShelfNote>

      <ShelfRow label="Kaç nota?" testId="count">
        {COUNTS.map((option) => (
          <ShelfChoice
            key={option}
            testId={`count-${option}`}
            label={`${option} nota`}
            active={count === option}
            onPress={() => {
              setCount(option);
              setFrets(SEED_FRETS[option]!);
              onDiscard();
            }}
          />
        ))}
      </ShelfRow>

      <ShelfRow label="Perdeler" testId="frets">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className="flex shrink-0 items-center gap-1">
            <ShelfChoice
              testId={`fret-${index}-down`}
              label="−"
              onPress={() => setFret(index, (frets[index] ?? 0) - 1)}
            />
            <span
              data-fret-value={index}
              className="text-text min-w-8 text-center font-mono text-sm"
            >
              {frets[index] ?? 0}
            </span>
            <ShelfChoice
              testId={`fret-${index}-up`}
              label="+"
              onPress={() => setFret(index, (frets[index] ?? 0) + 1)}
            />
          </span>
        ))}
      </ShelfRow>

      <ShelfRow label="Nasıl çalınsın?" testId="performance">
        {(["separate", "connected"] as const).map((option) => (
          <ShelfChoice
            key={option}
            testId={`performance-${option}`}
            label={SEQUENCE_PERFORMANCE_LABELS[option]}
            active={performance === option}
            onPress={() => {
              setPerformance(option);
              onDiscard();
            }}
          />
        ))}
      </ShelfRow>

      {ambiguous ? (
        <ShelfNote tone="warn" testId="ambiguous">
          {AMBIGUOUS_CONNECTION_TEXT}
        </ShelfNote>
      ) : null}

      {refusal ? <ShelfNote tone="warn" testId="refusal">{refusal}</ShelfNote> : null}

      {needsOverride ? (
        <div className="flex flex-col gap-1" data-availability="requires_local_override">
          <ShelfNote testId="override-detail">{LOCAL_OVERRIDE_DETAIL}</ShelfNote>
        </div>
      ) : null}

      {availability?.state === "unavailable" ? (
        <ShelfNote tone="warn" testId="unavailable">
          {availability.reason}
        </ShelfNote>
      ) : null}

      <div className="flex gap-1.5" data-panel-actions="fast-sequence">
        <ShelfSecondary
          testId="listen"
          label="Dinle"
          reason={proposal ? undefined : "Önce diziyi yazılabilir hale getir."}
          onPress={listen}
        />
        {/*
          One loud button, and it is whatever the next step actually is (§17).
          While the run needs a denser local grid, that *is* the next step and
          it says so; asking is what §8 requires before a resolution changes.
        */}
        {needsOverride ? (
          <ShelfPrimary
            testId="accept-override"
            label={LOCAL_OVERRIDE_ACTION}
            onPress={() => setOverrideAccepted(true)}
          />
        ) : (
          <ShelfPrimary
            testId="apply"
            label="Uygula"
            reason={proposal ? undefined : "Önce diziyi yazılabilir hale getir."}
            onPress={() => {
              const next = draft ?? stage();
              if (next) onApply(next);
            }}
          />
        )}
      </div>
    </div>
  );
}

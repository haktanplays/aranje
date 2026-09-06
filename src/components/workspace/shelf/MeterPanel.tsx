"use client";

/**
 * Ölçü, His and Grid — the three questions a bar answers (2V-D.2 §5, §6, §17).
 *
 * ## Simple is five sentences
 *
 * The first surface is the five intents from `rhythm-modes`, which are things
 * a guitarist says: Düz 4/4, Üçlemeli 4/4, Karışık 4/4, 3/4, 6/8. No
 * numerator, no denominator, no PPQ, no resolution, no slot count and no
 * grouping array — those are all behind **Daha fazla**, which is a region of
 * this same panel and not a second screen.
 *
 * ## Nothing is written until it has been previewed
 *
 * Every choice goes through `previewMeterChange` first, and the answer is
 * shown before the reader can apply it: a summary when it fits, a sentence in
 * their own language when it does not. There is no "make it fit" — a bar
 * whose last notes do not survive the new metre says so and stays as it is
 * (§14).
 *
 * ## It sits in the shelf, so the grid stays visible
 *
 * Like every other panel: a region of the ordinary layout, below the grid in
 * portrait and beside it in landscape. No modal, no `fixed inset-0`, nothing
 * that can cover the music the reader is deciding about.
 */
import { useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfPrimary,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import { groupingLabel } from "@/lib/music/meter-beats";
import { readRhythm } from "@/lib/music/rhythm-language";
import {
  SIMPLE_INTENTS,
  openProMeters,
  resolveIntent,
  type SimpleIntentId,
} from "@/lib/music/rhythm-modes";
import { readTempo } from "@/lib/music/tempo-reading";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import { conceptLabel } from "@/lib/music/rhythm-vocabulary";
import type { OfferedResolution, TimeSignature } from "@/lib/music/timing";
import type { MeterChangePreview } from "@/lib/song/meter-change-preview";

export type MeterDraft = {
  readonly meter: TimeSignature;
  readonly resolution: OfferedResolution;
  readonly grouping: BeatGrouping;
};

export function MeterPanel({
  bpm,
  current,
  draft,
  preview,
  onDraft,
  onApply,
}: {
  /** The tempo in force here, so the reading can name the felt beat. */
  bpm: number;
  /** What the bar is written in now. */
  current: MeterDraft;
  /** What the reader has picked but not applied, or null. */
  draft: MeterDraft | null;
  /** What applying the draft would do. Null while nothing is drafted. */
  preview: MeterChangePreview | null;
  onDraft: (next: MeterDraft) => void;
  onApply: () => void;
}) {
  const [pro, setPro] = useState(false);

  const shown = draft ?? current;
  const reading = readRhythm(shown.meter, shown.resolution, shown.grouping);
  const tempo = readTempo({
    bpm,
    meter: shown.meter,
    resolution: shown.resolution,
    grouping: shown.grouping,
  });
  const proMeters = pro ? openProMeters() : [];

  return (
    <div className="flex flex-col gap-2" data-panel="meter">
      <ShelfRow label={conceptLabel("meter")} testId="meter-intent">
        {SIMPLE_INTENTS.map((intent) => {
          const resolved = resolveIntent(intent.id as SimpleIntentId);
          const active =
            shown.meter[0] === resolved.meter[0] &&
            shown.meter[1] === resolved.meter[1] &&
            shown.resolution === resolved.resolution;
          return (
            <ShelfChoice
              key={intent.id}
              testId={`meter-${intent.id}`}
              label={intent.label}
              spoken={`${intent.label}: ${intent.hint}`}
              active={active}
              onPress={() => onDraft(resolved)}
            />
          );
        })}
      </ShelfRow>

      {/*
        The reading, and the two things it must never be confused with. The
        beat count is what a player counts; the subdivision line says what is
        actually in the bar, so three main beats in a 7/8 can never be read as
        three eighths (2V-D.2 c2, guardrail 2).
      */}
      <ShelfNote testId="meter-reading">{reading.plain}</ShelfNote>
      {reading.subdivision ? (
        <ShelfNote testId="meter-subdivision">{reading.subdivision}</ShelfNote>
      ) : null}
      <ShelfNote testId="meter-tempo">
        {tempo.feltBeat ? `${tempo.canonical} · ${tempo.feltBeat}` : tempo.canonical}
      </ShelfNote>

      {preview ? (
        <ShelfNote testId="meter-preview">
          {preview.ok ? preview.summary : preview.refusal}
        </ShelfNote>
      ) : null}

      <div className="flex items-center gap-1.5">
        <ShelfSecondary
          testId="meter-more"
          label="Daha fazla"
          active={pro}
          onPress={() => setPro((open) => !open)}
        />
        {draft ? (
          <ShelfPrimary
            testId="meter-apply"
            label="Uygula"
            reason={preview && !preview.ok ? preview.refusal : undefined}
            onPress={onApply}
          />
        ) : null}
      </div>

      {pro ? (
        <>
          <ShelfRow label={`${conceptLabel("meter")} · tümü`} testId="meter-pro">
            {proMeters.map((option) => (
              <ShelfChoice
                key={`${option.meter[0]}/${option.meter[1]}`}
                testId={`meter-pro-${option.meter[0]}-${option.meter[1]}`}
                label={`${option.meter[0]}/${option.meter[1]}`}
                active={
                  shown.meter[0] === option.meter[0] && shown.meter[1] === option.meter[1]
                }
                onPress={() =>
                  onDraft({
                    meter: [option.meter[0], option.meter[1]] as TimeSignature,
                    resolution: option.grids[0] ?? shown.resolution,
                    grouping: option.groupings[0] ?? shown.grouping,
                  })
                }
              />
            ))}
          </ShelfRow>

          <ShelfRow label={conceptLabel("feel")} testId="meter-feel">
            {(
              openProMeters().find(
                (option) =>
                  option.meter[0] === shown.meter[0] && option.meter[1] === shown.meter[1],
              )?.groupings ?? []
            ).map((grouping) => (
              <ShelfChoice
                key={groupingLabel(grouping)}
                testId={`meter-feel-${groupingLabel(grouping)}`}
                label={groupingLabel(grouping)}
                spoken={`Vurgu: ${groupingLabel(grouping)}`}
                active={groupingLabel(shown.grouping) === groupingLabel(grouping)}
                onPress={() => onDraft({ ...shown, grouping })}
              />
            ))}
          </ShelfRow>
        </>
      ) : null}
    </div>
  );
}

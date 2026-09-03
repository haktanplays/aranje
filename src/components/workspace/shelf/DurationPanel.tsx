"use client";

/**
 * How long, in verbs (2V-B.4 §6).
 *
 * The nine note-value names the old sheet opened with are gone from the first
 * surface. What is here is what a beginner would say out loud — uzat, kısalt,
 * ikiye böl, sonraki notaya kadar — and the exact value is one tap away under
 * "Ayrıntılar", where somebody who wants it can find it and nobody else has
 * to read it.
 *
 * The three divide actions hand over to the fast-sequence flow rather than
 * doing something of their own: "üçe böl" *is* three notes in this space, and
 * two different implementations of that would be two answers to one musical
 * idea.
 */
import { useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import {
  DIVIDE_COUNT,
  detailedLength,
  durationOffers,
} from "@/lib/music/duration-language";
import { measureLabel } from "@/lib/chords/chord-naming";
import type { EditTarget } from "@/lib/workspace/edit-target";

export function DurationPanel({
  target,
  onSetLength,
  onDivide,
  onDensify,
}: {
  target: EditTarget;
  /** Make the note under the finger this long, in ticks. */
  onSetLength: (ticks: number) => void;
  /** Hand over to the fast run with this many notes. */
  onDivide: (count: 2 | 3 | 4) => void;
  /** Open the same flow at the point where it asks for a finer grid. */
  onDensify: () => void;
}) {
  const [details, setDetails] = useState(false);

  const offers = durationOffers({
    currentTicks: target.currentTicks,
    slotTicks: target.slotTicks,
    beatTicks: target.beatTicks,
    maxTicks: target.maxTicks,
    toNextOnsetTicks:
      target.nextOnsetTicks === null ? null : target.nextOnsetTicks - target.startTicks,
  });

  return (
    <div className="flex flex-col gap-2" data-panel="duration">
      <ShelfRow label={`${measureLabel(target.barNumber)} · süre`} testId="duration">
        {offers.map((offer) => (
          <ShelfChoice
            key={offer.id}
            testId={`duration-${offer.id}`}
            label={offer.label}
            reason={offer.reason}
            onPress={() => {
              const divide = DIVIDE_COUNT[offer.id];
              if (divide) {
                onDivide(divide);
                return;
              }
              if (offer.kind === "densify") {
                onDensify();
                return;
              }
              if (offer.ticks !== null) onSetLength(offer.ticks);
            }}
          />
        ))}
      </ShelfRow>

      <div className="flex items-center gap-1.5">
        <ShelfSecondary
          testId="details"
          label="Ayrıntılar"
          active={details}
          onPress={() => setDetails((open) => !open)}
        />
        {details ? (
          <ShelfNote testId="length-detail">
            {detailedLength(target.currentTicks, target.slotTicks)}
          </ShelfNote>
        ) : null}
      </div>
    </div>
  );
}

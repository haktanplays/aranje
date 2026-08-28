"use client";

import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { CountingLine } from "@/lib/music/counting-language";
import type { RhythmChoice } from "@/lib/song/rhythm-choice";

/**
 * The rhythm the next note will be written at (2T-C §2, §4).
 *
 * ## Three questions, three sentences
 *
 * "4/4", "132" and "1/16" were three numbers on one screen with nothing
 * saying they answered different questions, and a reader could not tell which
 * was which. They are the bar's shape, how fast it goes, and how finely a
 * beat is divided for writing — so each gets a label and its own line, and no
 * number appears without one. The technical name is in the accessible
 * description, where a reader who wants it can find it and a reader who does
 * not is not made to read it.
 *
 * ## Why the value is chosen before the note is written
 *
 * Because a note has to say how long it is. Before this the length came from
 * the tie run under it, which is a reading of the old model — good for
 * opening an old song, wrong for writing a new one. What the reader picks
 * here becomes the note's own `durationTicks`.
 *
 * A value the bar has no room for is greyed rather than hidden: "the bar is
 * why you cannot have a whole note here" is worth knowing, and an option that
 * vanishes teaches nobody anything.
 */
export function RhythmRow({
  counting,
  choices,
  ticks,
  onChoose,
}: {
  counting: readonly CountingLine[];
  choices: readonly RhythmChoice[];
  ticks: number;
  onChoose: (ticks: number) => void;
}) {
  if (counting.length === 0) return null;

  return (
    <div className="border-line border-t pt-3" data-rhythm-row>
      <div className="pb-2" data-counting>
        {counting.map((line) => (
          <span
            key={line.text}
            data-counting-line
            className="text-muted block text-xs"
            aria-label={
              line.helper === null
                ? `${line.text} (${line.technical})`
                : `${line.text}. ${line.helper}. ${line.technical}`
            }
          >
            {line.text}
            {line.helper === null ? null : (
              <span className="text-muted/70"> · {line.helper}</span>
            )}
          </span>
        ))}
      </div>

      <span className="text-muted mb-1 block text-xs">Ritim değeri</span>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            key={choice.ticks}
            type="button"
            data-rhythm-choice={choice.ticks}
            aria-pressed={choice.ticks === ticks}
            disabled={!choice.fits}
            title={choice.fits ? undefined : "Bu ölçüde bu uzunluğa yer kalmadı."}
            onClick={() => onChoose(choice.ticks)}
            className={`border-line rounded-lg border px-3 text-sm disabled:opacity-40 ${
              choice.ticks === ticks ? "border-accent/60 bg-accent/15" : ""
            }`}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

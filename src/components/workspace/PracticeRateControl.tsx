"use client";

import {
  clampPercent,
  effectiveBpm,
  formatBpm,
  isDefaultPercent,
} from "@/lib/audio/practice-rate";
import { practiceRateLimits } from "@/lib/limits";

const STEP = practiceRateLimits.stepPercent;

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="border-line text-muted flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-base disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

/**
 * Practice speed (spec 13.8).
 *
 * Three things are on screen at once on purpose: the tempo the song is written
 * at, the rate, and what that comes to. A musician who only sees "75%" has to
 * do the arithmetic themselves, and one who only sees "99 BPM" cannot tell
 * whether the song was written that slow.
 */
export function PracticeRateControl({
  songBpm,
  percent,
  onChange,
}: {
  songBpm: number;
  percent: number;
  onChange: (percent: number) => void;
}) {
  const current = clampPercent(percent);
  const atMin = current <= practiceRateLimits.minPercent;
  const atMax = current >= practiceRateLimits.maxPercent;
  const atDefault = isDefaultPercent(current);
  const effective = effectiveBpm(songBpm, current);

  return (
    <div
      role="group"
      aria-label="Çalışma hızı"
      className="flex flex-wrap items-center gap-2"
    >
      <StepButton
        label={`Çalışma hızını yüzde ${STEP} azalt`}
        onClick={() => onChange(current - STEP)}
        disabled={atMin}
      >
        &minus;
      </StepButton>

      <output
        aria-live="polite"
        className="text-text w-12 shrink-0 text-center font-mono text-sm tabular-nums"
      >
        %{current}
      </output>

      <StepButton
        label={`Çalışma hızını yüzde ${STEP} artır`}
        onClick={() => onChange(current + STEP)}
        disabled={atMax}
      >
        +
      </StepButton>

      <StepButton
        label={`Çalışma hızını yüzde ${practiceRateLimits.defaultPercent} yap`}
        onClick={() => onChange(practiceRateLimits.defaultPercent)}
        disabled={atDefault}
      >
        &#8634;
      </StepButton>

      <p className="text-muted min-w-0 text-[11px] tabular-nums">
        {songBpm} BPM · %{current}
        {atDefault ? null : ` → ${formatBpm(effective)} BPM`}
      </p>
    </div>
  );
}

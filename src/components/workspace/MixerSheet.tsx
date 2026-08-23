"use client";

/**
 * The mixer (spec 13.18, 2L-C §9).
 *
 * One row per track, and every value in it already decided: the controller
 * hands over text as well as numbers, so this file does no dB arithmetic, no
 * percentage, no id-to-label lookup and no rule about who is heard.
 *
 * Two things are deliberately not the same control. **Ses** and **Stereo
 * konum** are a draft of the song, applied together by "Uygula". **Sustur**
 * and **Tek dinle** are how you are listening right now: they take effect
 * immediately, they are never written to the song, and "Vazgeç" leaves them
 * exactly where they are.
 *
 * The two audition controls have to be readable without colour, so each is a
 * word, a pressed state and an accessible name that says what it will do.
 * Nothing on this screen says "M", "S", "pan", "gain" or "bus".
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { mixerLimits } from "@/lib/limits";
import {
  MIX_SCOPE_NOTE,
  MIX_SESSION_ONLY_NOTE,
  MIX_STALE_MESSAGE,
} from "@/lib/song/track-mix-messages";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { MixerHandle, MixerRow } from "@/lib/workspace/use-mixer";

const TARGET = { minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX };

/** A small square control that stays a real touch target on a 320px screen. */
function Nudge({
  label,
  onClick,
  children,
  ...rest
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="border-line text-muted shrink-0 rounded-lg border text-sm"
      style={TARGET}
      {...rest}
    >
      {children}
    </button>
  );
}

function Row({
  row,
  mixer,
  disabled,
}: {
  row: MixerRow;
  mixer: MixerHandle;
  disabled: boolean;
}) {
  const step = (delta: number) =>
    mixer.setVolume(
      row.trackId,
      Math.min(
        mixerLimits.volumeDb.max,
        Math.max(mixerLimits.volumeDb.min, row.volumeDb + delta),
      ),
    );

  return (
    <section
      data-mixer-row={row.trackId}
      className="border-line border-b py-3 last:border-b-0"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm">{row.name}</span>
        <span className="text-muted shrink-0 text-[11px] opacity-80">
          {row.instrument}
        </span>
      </div>

      {/* How you are listening. Immediate, and never part of the song. */}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-mixer-mute={row.trackId}
          aria-pressed={row.muted}
          aria-label={row.muteLabel}
          onClick={() => mixer.toggleMuted(row.trackId)}
          className={`flex-1 rounded-lg border text-sm ${
            row.muted
              ? "border-reject text-reject bg-raised"
              : "border-line text-muted"
          }`}
          style={TARGET}
        >
          {row.muted ? "Susturuldu" : "Sustur"}
        </button>
        <button
          type="button"
          data-mixer-solo={row.trackId}
          aria-pressed={row.soloed}
          aria-label={row.soloLabel}
          onClick={() => mixer.toggleSoloed(row.trackId)}
          className={`flex-1 rounded-lg border text-sm ${
            row.soloed
              ? "border-bronze text-bronze bg-raised"
              : "border-line text-muted"
          }`}
          style={TARGET}
        >
          {row.soloed ? "Tek dinleniyor" : "Tek dinle"}
        </button>
      </div>

      <label className="mt-3 block">
        <span className="text-muted mb-1 flex items-baseline justify-between text-xs">
          <span>Ses</span>
          <span data-mixer-volume-text={row.trackId} className="tabular-nums">
            {row.volumeText}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <Nudge
            label={`${row.name}: sesi azalt`}
            onClick={() => step(-mixerLimits.volumeDb.step)}
            data-mixer-volume-down={row.trackId}
            disabled={disabled}
          >
            &minus;
          </Nudge>
          <input
            type="range"
            data-mixer-volume={row.trackId}
            aria-label={`${row.name}: ses düzeyi`}
            min={mixerLimits.volumeDb.min}
            max={mixerLimits.volumeDb.max}
            step={mixerLimits.volumeDb.step}
            value={row.volumeDb}
            disabled={disabled}
            onChange={(event) =>
              mixer.setVolume(row.trackId, Number(event.target.value))
            }
            className="min-w-0 flex-1"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          />
          <Nudge
            label={`${row.name}: sesi artır`}
            onClick={() => step(mixerLimits.volumeDb.step)}
            data-mixer-volume-up={row.trackId}
            disabled={disabled}
          >
            +
          </Nudge>
        </div>
      </label>

      <label className="mt-3 block">
        <span className="text-muted mb-1 flex items-baseline justify-between text-xs">
          <span>Stereo konum</span>
          <span data-mixer-pan-text={row.trackId}>{row.panText}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-muted shrink-0 text-[11px]">Sol</span>
          <input
            type="range"
            data-mixer-pan={row.trackId}
            aria-label={`${row.name}: stereo konum`}
            min={mixerLimits.pan.min}
            max={mixerLimits.pan.max}
            step={mixerLimits.pan.step}
            value={row.pan}
            disabled={disabled}
            onChange={(event) =>
              mixer.setPan(row.trackId, Number(event.target.value))
            }
            className="min-w-0 flex-1"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          />
          <span className="text-muted shrink-0 text-[11px]">Sağ</span>
          <Nudge
            label={`${row.name}: stereo konumu merkeze al`}
            onClick={() => mixer.centrePan(row.trackId)}
            data-mixer-pan-center={row.trackId}
            disabled={disabled}
          >
            &#8226;
          </Nudge>
        </div>
      </label>
    </section>
  );
}

export function MixerSheet({
  open,
  onClose,
  mixer,
  canPersist,
}: {
  open: boolean;
  onClose: () => void;
  mixer: MixerHandle;
  canPersist: boolean;
}) {
  if (!open) return null;

  const cancel = () => {
    mixer.cancel();
    onClose();
  };

  const apply = () => {
    if (mixer.apply()) onClose();
  };

  return (
    <Sheet
      open={open}
      title="Mikser"
      onClose={cancel}
      labelledBy="mixer-sheet-title"
      footer={
        <>
          {mixer.error && !mixer.stale ? (
            <p
              role="alert"
              data-mixer-error
              className="text-reject pb-2 text-xs"
            >
              {mixer.error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <SheetButton data-mixer-cancel onClick={cancel}>
              Vazgeç
            </SheetButton>
            <SheetButton
              data-mixer-apply
              tone="primary"
              onClick={apply}
              disabled={!mixer.canApply}
            >
              Uygula
            </SheetButton>
          </div>
        </>
      }
    >
      <p className="text-muted text-xs">{MIX_SCOPE_NOTE}</p>
      {!canPersist ? (
        <p data-mixer-session-note className="text-muted mt-1 text-xs">
          {MIX_SESSION_ONLY_NOTE}
        </p>
      ) : null}
      {mixer.stale ? (
        <p role="alert" data-mixer-stale className="text-reject mt-2 text-xs">
          {MIX_STALE_MESSAGE}
        </p>
      ) : null}

      <div data-mixer-sheet className="mt-2">
        {mixer.rows.map((row) => (
          <Row
            key={row.trackId}
            row={row}
            mixer={mixer}
            disabled={!mixer.canApply}
          />
        ))}
      </div>
    </Sheet>
  );
}

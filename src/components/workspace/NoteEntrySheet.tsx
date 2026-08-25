"use client";

/**
 * Where a note is chosen for a fretless instrument (2Q-B §7.2).
 *
 * ## Why it asks instead of guessing
 *
 * The lane below it has no pitch axis, so nothing about where the reader
 * tapped says which note they meant. That is deliberate: giving the lane a
 * vertical range would mean claiming a range for the instrument, and the
 * registry holds none (fretted instruments derive theirs from tuning and fret
 * count, spec 9.1). So the moment is chosen by tapping and the note is chosen
 * here, from a fixed twelve and a stepper.
 *
 * ## What it does not do
 *
 * - It does not know the song's key and never suggests a note because of one.
 *   Scale-aware suggestion is a musical opinion; this is a text field with
 *   better buttons.
 * - It does not offer a range. The octave stepper walks the Song Contract's
 *   own legal octaves (-1..9) and opens on an octave read from the music the
 *   reader already has — never on a number invented for the instrument.
 * - It does not preview a sound it cannot make. When the track's preset has
 *   no sample pack, Dinle is disabled and says so in one sentence, rather
 *   than playing a substitute instrument and letting the reader believe that
 *   is what their piano sounds like.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { describePitch } from "@/lib/music/note-names";
import type { PitchedNoteTarget } from "@/lib/workspace/use-event-entry";

/** The twelve, spelled with sharps: one row of buttons, in playing order. */
const PITCH_CLASSES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "C", label: "Do" },
  { value: "C#", label: "Do#" },
  { value: "D", label: "Re" },
  { value: "D#", label: "Re#" },
  { value: "E", label: "Mi" },
  { value: "F", label: "Fa" },
  { value: "F#", label: "Fa#" },
  { value: "G", label: "Sol" },
  { value: "G#", label: "Sol#" },
  { value: "A", label: "La" },
  { value: "A#", label: "La#" },
  { value: "B", label: "Si" },
];

/** The contract's own octave grammar, and nothing narrower. */
const LOWEST_OCTAVE = -1;
const HIGHEST_OCTAVE = 9;

/** What the reader is told when the instrument has no sound in this build. */
export const NO_SOUND_NOTICE =
  "Bu enstrümanın sesi bu sürümde bulunmuyor. Notaları düzenleyebilir ve MIDI olarak dışa aktarabilirsin.";

export function NoteEntrySheet({
  open,
  target,
  onClose,
  onWrite,
  onRemove,
  onChord,
  onPreview,
  error,
}: {
  open: boolean;
  target: PitchedNoteTarget | null;
  onClose: () => void;
  /** Write this pitch here. `replace` is the reader's explicit second answer. */
  onWrite: (pitch: string, options: { replace: boolean }) => void;
  onRemove: () => void;
  /**
   * Open the chord builder on this moment, when this track has one.
   *
   * Optional rather than always present: a door that leads nowhere is worse
   * than no door, and the builder answers for the instruments it can voice.
   */
  onChord?: (() => void) | undefined;
  /** Play the chosen note, only ever offered when the track can sound. */
  onPreview: (pitch: string) => void;
  error: string | null;
}) {
  const [pitchClass, setPitchClass] = useState("A");
  const [octave, setOctave] = useState(target?.octave ?? 4);

  if (!target) return null;

  const pitch = `${pitchClass}${octave}`;
  const written = target.pitches.length > 0;
  const description = describePitch(pitch);

  return (
    <Sheet
      open={open}
      title={`Ölçü ${target.barNumber} · adım ${target.slotIndex + 1}`}
      onClose={onClose}
      labelledBy="note-entry-title"
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={onClose}>Kapat</SheetButton>
          <SheetButton
            tone="primary"
            onClick={() => onWrite(pitch, { replace: written })}
          >
            {written ? "Değiştir" : "Yaz"}
          </SheetButton>
        </div>
      }
    >
      <div className="space-y-4">
        {written ? (
          <p data-note-current className="text-muted text-sm">
            Şu an burada: {target.pitches.join(" · ")}
          </p>
        ) : null}

        <div>
          <p className="text-muted mb-2 text-xs">Nota</p>
          <div className="grid grid-cols-6 gap-1.5">
            {PITCH_CLASSES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                data-pitch-class={entry.value}
                aria-pressed={entry.value === pitchClass}
                onClick={() => setPitchClass(entry.value)}
                className={`min-h-11 rounded-lg border text-sm ${
                  entry.value === pitchClass
                    ? "border-bronze text-bronze"
                    : "border-line text-text"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-muted mb-2 text-xs">Oktav</p>
          <div className="flex items-center gap-3">
            <SheetButton
              onClick={() => setOctave((value) => Math.max(LOWEST_OCTAVE, value - 1))}
              disabled={octave <= LOWEST_OCTAVE}
            >
              −
            </SheetButton>
            <span data-note-octave className="text-text w-8 text-center tabular-nums">
              {octave}
            </span>
            <SheetButton
              onClick={() => setOctave((value) => Math.min(HIGHEST_OCTAVE, value + 1))}
              disabled={octave >= HIGHEST_OCTAVE}
            >
              +
            </SheetButton>
          </div>
        </div>

        <p data-note-description className="text-text text-sm">
          {description}
        </p>

        {target.audible ? (
          <SheetButton onClick={() => onPreview(pitch)}>Dinle</SheetButton>
        ) : (
          <div>
            <SheetButton onClick={onClose} disabled>
              Dinle
            </SheetButton>
            <p data-note-silent className="text-muted mt-2 text-xs">
              {NO_SOUND_NOTICE}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {onChord ? <SheetButton onClick={onChord}>Akor kur</SheetButton> : null}
          <SheetButton tone="danger" onClick={onRemove} disabled={!written}>
            Sil
          </SheetButton>
        </div>

        {error ? (
          <p data-note-error role="alert" className="text-danger text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

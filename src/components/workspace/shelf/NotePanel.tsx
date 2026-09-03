"use client";

/**
 * The note under the finger, in the shelf (2V-B.4 §4, §6, §17).
 *
 * ## What this replaced, measured
 *
 * A tap on a cell used to open a bottom sheet — `fixed inset-0 z-30`, up to
 * 85% of the screen — headed **"Bar 1 · slot 1 · tel 1"**, carrying nine note
 * values, a "Süre − ikilik +" stepper, four arrows, three articulation rows
 * and two competing calls to action at the bottom. It covered the grid at all
 * six measured viewports. A reader could not see the music they were editing.
 *
 * The same tap now opens this: a row in the shelf, below the grid in portrait
 * and beside it in landscape, with a fret, a length in verbs and a
 * connection. The exact value is under "Ayrıntılar" and nowhere else.
 *
 * ## It decides nothing
 *
 * Every press here calls a handle the note-editing controller already owns.
 * This component knows which words to use and what order to put them in; the
 * commands, the atomicity and the history are where they always were.
 */
import { useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import { detailedLength } from "@/lib/music/duration-language";
import { measureLabel } from "@/lib/chords/chord-naming";
import type { EditTarget } from "@/lib/workspace/edit-target";

/** How a string is named out loud on a six-string guitar, thickest first. */
const STRING_NAMES: readonly string[] = [
  "Mi (kalın)",
  "La",
  "Re",
  "Sol",
  "Si",
  "Mi (ince)",
];

/** The three ways two notes are joined. The rest live in the Çalım shelf. */
const CONNECTIONS = [
  { id: "hammer_on", label: "Hammer-on" },
  { id: "pull_off", label: "Pull-off" },
  { id: "slide", label: "Slide" },
] as const;

export function NotePanel({
  target,
  fret,
  pitch,
  articulation,
  error,
  onFret,
  onClear,
  onConnection,
  onOpenDuration,
  onOpenDetails,
}: {
  target: EditTarget;
  /** The fret written here, or null when the position is empty. */
  fret: number | null;
  /** What it sounds, for the reader to recognise. */
  pitch: string | null;
  articulation: string | null;
  error: string | null;
  onFret: (next: number) => void;
  onClear: () => void;
  onConnection: (id: string | null) => void;
  /** Hand over to the Süre panel, which owns the length verbs. */
  onOpenDuration: () => void;
  /**
   * The full technique sheet, on request (§17).
   *
   * Sixteen techniques, the retune and the shape work are more than a shelf
   * row can hold honestly. They stay one press away, behind a name that says
   * what is behind it, rather than arriving unasked over the grid.
   */
  onOpenDetails: () => void;
}) {
  const [details, setDetails] = useState(false);
  const stringName =
    target.stringIndex === null ? "" : (STRING_NAMES[target.stringIndex] ?? `${target.stringIndex + 1}. tel`);

  return (
    <div className="flex flex-col gap-2" data-panel="note">
      <ShelfNote testId="note-where">
        {measureLabel(target.barNumber)} · {stringName}
        {pitch ? ` · ${pitch}` : ""}
      </ShelfNote>

      <ShelfRow label="Perde" testId="fret">
        <ShelfChoice
          testId="fret-down"
          label="−"
          spoken="Perdeyi bir eksilt"
          reason={fret === null || fret <= 0 ? "Boş tel en aşağısı." : undefined}
          onPress={() => onFret(Math.max(0, (fret ?? 0) - 1))}
        />
        <span data-note-fret className="text-text min-w-10 text-center font-mono text-base">
          {fret ?? "—"}
        </span>
        <ShelfChoice
          testId="fret-up"
          label="+"
          spoken="Perdeyi bir artır"
          onPress={() => onFret(Math.min(24, (fret ?? -1) + 1))}
        />
        <ShelfChoice
          testId="clear"
          label="Sustur"
          reason={fret === null ? "Burada nota yok." : undefined}
          onPress={onClear}
        />
      </ShelfRow>

      <ShelfRow label="Bağlantı" testId="connection">
        {CONNECTIONS.map((entry) => (
          <ShelfChoice
            key={entry.id}
            testId={`connection-${entry.id}`}
            label={entry.label}
            active={articulation === entry.id}
            reason={fret === null ? "Önce bir nota yaz." : undefined}
            onPress={() => onConnection(articulation === entry.id ? null : entry.id)}
          />
        ))}
      </ShelfRow>

      {error ? <ShelfNote tone="warn" testId="note-error">{error}</ShelfNote> : null}

      <div className="flex items-center gap-1.5" data-panel-actions="note">
        <ShelfSecondary testId="open-duration" label="Süre" onPress={onOpenDuration} />
        <ShelfSecondary
          testId="open-techniques"
          label="Tüm teknikler"
          reason={fret === null ? "Önce bir nota yaz." : undefined}
          onPress={onOpenDetails}
        />
        <ShelfSecondary
          testId="details"
          label="Ayrıntılar"
          active={details}
          onPress={() => setDetails((open) => !open)}
        />
        {details ? (
          <ShelfNote testId="note-detail">
            {detailedLength(target.currentTicks, target.slotTicks)}
          </ShelfNote>
        ) : null}
      </div>
    </div>
  );
}

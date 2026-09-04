"use client";

/**
 * Two strings, asked about as one hand (2V-C.3 §12).
 *
 * ## Not a second editor
 *
 * A "polyphonic gesture editor" would be a new surface for a thing the reader
 * already knows how to ask for: they touched a double stop and pressed
 * "Kaydır". So this is the same row, deciding from what is under the cursor.
 * One matching voice gets the six single-note options it always had; two or
 * more get these two, because the other four have no meaning for a shape —
 * there is no "slide in from below" for a grip, only "does the target get
 * picked again".
 *
 * ## It says what will happen, in strings and a direction
 *
 * "2 tel birlikte yukarı kayacak" is the whole summary. No string index, no
 * cents, no fret arithmetic and no id of ours: the reader is holding a shape
 * and moving it, and the only two facts they need are how many strings come
 * along and which way.
 */
import { ShelfChoice, ShelfNote, ShelfRow } from "@/components/workspace/shelf/ShelfControls";

/** The two questions a shape can answer. Neither is a distance. */
export const SHAPE_KINDS = [
  { id: "legato", label: "Bağlı", spoken: "Hedef şekil yeniden vurulmaz." },
  { id: "shift", label: "Vurarak", spoken: "Hedef şekil yeniden vurulur." },
] as const;

export type ShapeKindId = (typeof SHAPE_KINDS)[number]["id"];

export function ShapeSlideRow({
  chosen,
  offers,
  summary,
  onChoose,
}: {
  chosen: ShapeKindId | null;
  /** Whether each kind can actually be written here, and why not. */
  offers: readonly {
    readonly id: ShapeKindId;
    readonly ok: boolean;
    readonly reason?: string;
  }[];
  /** What the gesture will do, in musician language. */
  summary: string;
  onChoose: (id: ShapeKindId | null) => void;
}) {
  return (
    <>
      <ShelfRow label="Nasıl?" testId="shape">
        {SHAPE_KINDS.map((entry) => {
          const offer = offers.find((candidate) => candidate.id === entry.id);
          return (
            <ShelfChoice
              key={entry.id}
              testId={`shape-${entry.id}`}
              label={entry.label}
              spoken={entry.spoken}
              active={chosen === entry.id}
              reason={offer?.ok === false ? offer.reason : undefined}
              onPress={() => onChoose(chosen === entry.id ? null : entry.id)}
            />
          );
        })}
      </ShelfRow>
      <ShelfNote testId="shape-summary">{summary}</ShelfNote>
    </>
  );
}

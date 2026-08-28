"use client";

import {
  CHORD_QUALITY_IDS,
  ROOT_SHORT_LABELS,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/**
 * "Ritmi koru, akoru değiştir" (2T-C §7).
 *
 * ## What the reader is actually being offered
 *
 * The same figure, over a different chord. Every onset stays where it is,
 * every length stays what it is, every articulation, let-ring and strum comes
 * with it — only the pitches move, and they move as *voices*: the first voice
 * of the old chord becomes the first voice of the new one. Notes that were
 * not chord tones keep their exact distance from the note they were
 * decorating, so a neighbour stays a neighbour.
 *
 * ## Two chords, not one
 *
 * The transform needs to know what it is moving *from*, and the passage
 * already knows: the source is proposed from the notes on screen and left
 * editable. A reader who disagrees changes it; a reader who does not is not
 * made to answer a question the app could answer itself.
 *
 * ## Nothing happens until it is applied
 *
 * The preview runs the same transform the apply runs, on the same song, and
 * throws the result away. It lists what would move and any warning the
 * transform produced — an ornament with nothing to attach to, a voice the
 * target chord has no room for — so the reader can decide before anything is
 * written rather than discover it afterwards.
 *
 * No provider is called and no model is asked. Same passage, same target,
 * same answer, every time.
 */

export type HarmonyChoiceValue = {
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
};

const QUALITY_LABELS: Readonly<Record<ChordQualityId, string>> = {
  major: "majör",
  minor: "minör",
  power: "power",
  sus2: "sus2",
  sus4: "sus4",
  diminished: "eksilmiş",
  augmented: "artmış",
  dominant_7: "dominant 7",
  major_7: "majör 7",
  minor_7: "minör 7",
  half_diminished_7: "yarı eksilmiş 7",
};

const FIELD =
  "border-line bg-surface w-full rounded-lg border px-2 text-sm";

function ChordPicker({
  label,
  value,
  testId,
  onChange,
}: {
  label: string;
  value: HarmonyChoiceValue | null;
  testId: string;
  onChange: (choice: HarmonyChoiceValue) => void;
}) {
  const root = value?.rootPitchClass ?? 0;
  const quality = value?.quality ?? "minor";
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-muted w-16 shrink-0 text-xs">{label}</span>
      <select
        data-testid={`${testId}-root`}
        aria-label={`${label} kök ses`}
        value={String(root)}
        onChange={(event) =>
          onChange({ rootPitchClass: Number(event.target.value), quality })
        }
        className={FIELD}
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        {ROOT_SHORT_LABELS.map((name, index) => (
          <option key={name} value={String(index)}>
            {name}
          </option>
        ))}
      </select>
      <select
        data-testid={`${testId}-quality`}
        aria-label={`${label} akor türü`}
        value={quality}
        onChange={(event) =>
          onChange({
            rootPitchClass: root,
            quality: event.target.value as ChordQualityId,
          })
        }
        className={FIELD}
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        {CHORD_QUALITY_IDS.map((id) => (
          <option key={id} value={id}>
            {QUALITY_LABELS[id]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function RetuneSection({
  from,
  to,
  preview,
  onFrom,
  onTo,
  onApply,
}: {
  from: HarmonyChoiceValue | null;
  to: HarmonyChoiceValue | null;
  preview:
    | { kind: "idle" }
    | {
        kind: "ready";
        moves: readonly { from: string; to: string }[];
        warnings: readonly { kind: string; message: string }[];
      }
    | { kind: "refused"; reason: string };
  onFrom: (choice: HarmonyChoiceValue) => void;
  onTo: (choice: HarmonyChoiceValue) => void;
  onApply: () => void;
}) {
  return (
    <div className="border-line border-t pt-3" data-retune-section>
      <span className="text-muted block pb-1 text-sm">Ritmi koru, akoru değiştir</span>
      <p className="text-muted/80 pb-1 text-xs">
        Vuruşlar, süreler ve ifadeler yerinde kalır; yalnız perdeler yeni
        akorun karşılık gelen seslerine taşınır.
      </p>

      <ChordPicker label="Şu anki" value={from} testId="retune-from" onChange={onFrom} />
      <ChordPicker label="Yeni" value={to} testId="retune-to" onChange={onTo} />

      <div
        data-retune-preview
        data-state={preview.kind}
        className={`py-2 text-xs ${
          preview.kind === "refused" ? "text-danger" : "text-muted"
        }`}
      >
        {preview.kind === "idle" ? (
          "Yeni akoru seçince burada ne olacağını görürsün."
        ) : preview.kind === "refused" ? (
          preview.reason
        ) : (
          <>
            <span className="block">
              {preview.moves.length} nota taşınır, hiçbiri yerinden oynamaz.
            </span>
            <span className="block truncate">
              {preview.moves
                .slice(0, 6)
                .map((move) => `${move.from}→${move.to}`)
                .join("  ")}
              {preview.moves.length > 6 ? " …" : ""}
            </span>
            {preview.warnings.map((warning) => (
              <span
                key={`${warning.kind}-${warning.message}`}
                data-retune-warning={warning.kind}
                className="text-bronze block"
              >
                {warning.message}
              </span>
            ))}
          </>
        )}
      </div>

      <button
        type="button"
        data-retune-apply
        disabled={preview.kind !== "ready"}
        onClick={onApply}
        className="border-accent/60 bg-accent/15 w-full rounded-lg border text-sm disabled:opacity-40"
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        Uygula
      </button>
    </div>
  );
}

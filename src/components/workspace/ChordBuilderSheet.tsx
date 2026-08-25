"use client";

/**
 * Choosing a chord (spec 13.22 §17, §18, 2O-B).
 *
 * View only. Every word it shows comes from the copy layer, every shape from
 * the voicing search, every refusal from the one message table — nothing here
 * decides what a chord is, what it is called, or whether it can be written.
 *
 * It is a stepped sheet rather than one long form on purpose: a phone at
 * 320 px cannot hold twelve roots, ten qualities, a position picker and four
 * shape cards at once, and squeezing them in would make every one of them too
 * small to press.
 */
import { NO_SOUND_NOTICE } from "@/components/workspace/NoteEntrySheet";
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  CHORD_FORMULA_LIST,
  ROOT_LABELS,
  ROOT_PITCH_CLASSES,
} from "@/lib/chords/chord-formula";
import {
  capoNote,
  shapeDigits,
  stackNote,
  voicingLabel,
} from "@/lib/chords/chord-copy";
import { CHORD_ARTICULATIONS } from "@/lib/chords/chord-command";
import type { ChordBuilderHandle } from "@/lib/workspace/use-chord-builder";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

const ARTICULATION_LABELS: Readonly<Record<string, string>> = {
  normal: "Normal",
  accent: "Vurgulu",
  palm_mute: "Palm mute",
  sustain: "Uzun",
  staccato: "Kısa",
};

const STEP_LABELS: readonly { id: "type" | "root" | "quality" | "voicing"; label: string }[] = [
  { id: "type", label: "Tür" },
  { id: "root", label: "Kök" },
  { id: "quality", label: "Akor" },
  { id: "voicing", label: "Şekil" },
];

function Chip({
  onClick,
  selected,
  children,
  testId,
}: {
  onClick: () => void;
  selected?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={selected}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      className={`rounded-lg border px-3 text-sm ${
        selected ? "border-gold text-gold" : "border-line text-text"
      }`}
    >
      {/* Selection is never colour alone: the pressed state is announced and
          the chosen card also carries a check. */}
      {selected ? `✓ ${children}` : children}
    </button>
  );
}

export function ChordBuilderSheet({
  builder,
  capo,
  audible,
  onAudition,
}: {
  builder: ChordBuilderHandle;
  /** The open track's capo, for the note on a fretted card. */
  capo: number;
  /**
   * False when this track's preset has no sound in this build (2Q-B §8).
   *
   * The shapes are still offered and still writable — a chord you cannot
   * hear yet is still a chord — but the audition button says so instead of
   * doing nothing when pressed.
   */
  audible: boolean;
  /** Play one shape, briefly. The engine belongs to the caller. */
  onAudition: (voicingId: string) => void;
}) {
  if (!builder.isOpen || !builder.target) return null;
  const { target } = builder;
  const capoText = capoNote(capo);

  return (
    <Sheet
      open
      title={
        target.occupied
          ? `Bar ${target.barNumber} · bu vuruşu akorla değiştir`
          : `Bar ${target.barNumber} · akoru yaz`
      }
      onClose={builder.close}
      labelledBy="chord-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={builder.close} data-chord-cancel>
            Vazgeç
          </SheetButton>
          <SheetButton
            tone="primary"
            onClick={builder.apply}
            disabled={!builder.canApply || builder.preview === null}
            data-chord-apply
          >
            Uygula
          </SheetButton>
        </div>
      }
    >
      <div data-chord-sheet className="pb-2">
        {/* Where the reader is, and a way back to any earlier step. */}
        <div className="mb-3 flex flex-wrap gap-2" data-chord-steps>
          {STEP_LABELS.map((step) => (
            <Chip
              key={step.id}
              testId={`chord-step-${step.id}`}
              selected={builder.step === step.id}
              onClick={() => builder.goTo(step.id)}
            >
              {step.label}
            </Chip>
          ))}
        </div>

        {target.occupied ? (
          <p className="text-bronze mb-3 text-xs" data-chord-replace-note>
            Bu vuruştaki notalar kaldırılacak ve yerine seçtiğin akor yazılacak.
          </p>
        ) : null}

        {builder.error ? (
          <p
            data-chord-error
            role="alert"
            className="border-reject/50 text-reject mb-3 rounded-lg border px-3 py-2 text-sm"
          >
            {builder.error}
          </p>
        ) : null}

        {builder.step === "type" ? (
          <div className="flex flex-col gap-2" data-chord-types>
            <SheetButton
              data-chord-type="power"
              tone={builder.isPower ? "primary" : undefined}
              onClick={() => builder.chooseType(true)}
            >
              Power chord
            </SheetButton>
            <SheetButton
              data-chord-type="chord"
              tone={builder.isPower ? undefined : "primary"}
              onClick={() => builder.chooseType(false)}
            >
              Akor
            </SheetButton>
          </div>
        ) : null}

        {builder.step === "root" ? (
          <div className="grid grid-cols-3 gap-2" data-chord-roots>
            {ROOT_PITCH_CLASSES.map((pitchClass) => (
              <Chip
                key={pitchClass}
                testId={`chord-root-${pitchClass}`}
                selected={builder.rootPitchClass === pitchClass}
                onClick={() => builder.chooseRoot(pitchClass)}
              >
                {ROOT_LABELS[pitchClass]}
              </Chip>
            ))}
          </div>
        ) : null}

        {builder.step === "quality" ? (
          builder.isPower ? (
            <div className="flex flex-col gap-2" data-chord-power-forms>
              <SheetButton
                data-chord-power="two"
                tone={builder.withOctave ? undefined : "primary"}
                onClick={() => {
                  builder.setWithOctave(false);
                  builder.goTo("voicing");
                }}
              >
                Kök + beşli
              </SheetButton>
              <SheetButton
                data-chord-power="three"
                tone={builder.withOctave ? "primary" : undefined}
                onClick={() => {
                  builder.setWithOctave(true);
                  builder.goTo("voicing");
                }}
              >
                Kök + beşli + oktav
              </SheetButton>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2" data-chord-qualities>
              {CHORD_FORMULA_LIST.filter((formula) => formula.id !== "power").map(
                (formula) => (
                  <Chip
                    key={formula.id}
                    testId={`chord-quality-${formula.id}`}
                    selected={builder.quality === formula.id}
                    onClick={() => builder.chooseQuality(formula.id)}
                  >
                    {formula.label}
                  </Chip>
                ),
              )}
            </div>
          )
        ) : null}

        {builder.step === "voicing" ? (
          <div className="flex flex-col gap-3" data-chord-voicings>
            <p className="text-muted text-xs" data-chord-name>
              {builder.name}
              {capoText ? ` · ${capoText}` : ""}
            </p>

            {audible ? null : (
              <p className="text-muted text-xs" data-chord-silent>
                {NO_SOUND_NOTICE}
              </p>
            )}

            {builder.voicings.length === 0 ? (
              <p className="text-muted text-sm" data-chord-no-voicing>
                Bu konumda çalınabilir bir akor şekli bulunamadı. Başlangıç
                perdesini veya varyasyonu değiştir.
              </p>
            ) : null}

            {builder.voicings.map((voicing) => (
              <div
                key={voicing.id}
                data-chord-voicing={voicing.id}
                className={`rounded-lg border p-3 ${
                  builder.selectedId === voicing.id
                    ? "border-gold"
                    : "border-line"
                }`}
              >
                <button
                  type="button"
                  onClick={() => builder.select(voicing.id)}
                  aria-pressed={builder.selectedId === voicing.id}
                  data-chord-select={voicing.id}
                  style={{ minHeight: MIN_TOUCH_TARGET_PX }}
                  className="block w-full text-left text-sm"
                >
                  <span className="font-display">
                    {builder.selectedId === voicing.id ? "✓ " : ""}
                    {builder.name}
                  </span>
                  <span className="text-muted block text-xs">
                    {voicingLabel(voicing, builder.rootPitchClass, builder.quality)}
                  </span>
                  <span className="text-muted block font-mono text-xs">
                    {voicing.kind === "fretted"
                      ? shapeDigits(voicing.shape).join(" ")
                      : stackNote(voicing)}
                  </span>
                </button>
                <SheetButton
                  data-chord-audition={voicing.id}
                  disabled={!audible}
                  onClick={() => onAudition(voicing.id)}
                >
                  Dinle
                </SheetButton>
              </div>
            ))}

            <div className="flex flex-wrap gap-2" data-chord-articulations>
              {CHORD_ARTICULATIONS.map((value) => (
                <Chip
                  key={value}
                  testId={`chord-articulation-${value}`}
                  selected={builder.articulation === value}
                  onClick={() => builder.setArticulation(value)}
                >
                  {ARTICULATION_LABELS[value] ?? value}
                </Chip>
              ))}
            </div>

            <div className="flex flex-wrap gap-2" data-chord-lengths>
              {[1, 2, 4].map((count) => (
                <Chip
                  key={count}
                  testId={`chord-length-${count}`}
                  selected={builder.slots === count}
                  onClick={() => builder.setSlots(count)}
                >
                  {count === 1 ? "1 adım" : `${count} adım`}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

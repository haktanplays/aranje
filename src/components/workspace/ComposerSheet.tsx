"use client";

/**
 * What is behind each door (2S-A §6, §11).
 *
 * One sheet, four contents, because a door is a place rather than a mode and
 * a reader who opened the wrong one should be able to see what was behind it
 * without learning four different screens.
 *
 * Every option carries a one-line explanation written for somebody who does
 * not read notation — "Sağ elinle tekrar vurmadan daha yüksek notaya geç."
 * rather than "hammer-on" — and those sentences live in the tool model, so
 * there is one place they can be got wrong.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import { maxCapoRelativeFret } from "@/lib/music/fretboard";
import {
  DOOR_LABELS,
  sameTool,
  toolHint,
  type ComposerDoor,
  type ComposerTool,
} from "@/lib/workspace/composer-tool";

export type ComposerSheetProps = {
  open: boolean;
  door: ComposerDoor;
  tool: ComposerTool;
  /** The capo the current track has, so the fret stepper stops where it must. */
  capo: number;
  onPick: (tool: ComposerTool) => void;
  onClose: () => void;
  /**
   * The wide catalogue, still there and no longer the first door.
   *
   * Null when there is no beat selected for it to open on: a builder with no
   * target is a sheet that can only be closed again.
   */
  onOpenChordBuilder: ((power: boolean) => void) | null;
  /** The rhythm door opens the grid sheet the song already has. */
  onOpenRhythm: (() => void) | null;
  /** Whether the track can carry a shape at all. */
  canWriteShapes: boolean;
};

/** One choice, with the sentence that says what it will do. */
function Option({
  label,
  hint,
  selected,
  testId,
  onClick,
}: {
  label: string;
  hint: string | null;
  selected: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-composer-option={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-2 text-left ${
        selected ? "border-bronze bg-bronze/10 text-bronze" : "border-line text-text"
      }`}
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
    >
      <span className="block text-sm font-medium">{label}</span>
      {hint ? <span className="text-muted block pt-0.5 text-xs">{hint}</span> : null}
    </button>
  );
}

export function ComposerSheet({
  open,
  door,
  tool,
  capo,
  onPick,
  onClose,
  onOpenChordBuilder,
  onOpenRhythm,
  canWriteShapes,
}: ComposerSheetProps) {
  const penFret = tool.kind === "power_chord" ? tool.fret : 5;
  const penVoices = tool.kind === "power_chord" ? tool.voices : 2;
  const maxFret = maxCapoRelativeFret(capo);

  const pen = (voices: 2 | 3, fret: number): ComposerTool => ({
    kind: "power_chord",
    voices,
    fret,
  });

  return (
    <Sheet
      open={open}
      title={DOOR_LABELS[door]}
      onClose={onClose}
      labelledBy="composer-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={onClose}>Kapat</SheetButton>
        </div>
      }
    >
      {door === "note" ? (
        <div className="flex flex-col gap-2 pb-3">
          <Option
            label="Nota"
            hint="Bir tele ve bir ana dokun, perdeyi yaz."
            selected={tool.kind === "note"}
            testId="note"
            onClick={() => onPick({ kind: "note" })}
          />
        </div>
      ) : null}

      {door === "shape" ? (
        <div className="flex flex-col gap-2 pb-3" data-composer-shape>
          {canWriteShapes ? (
            <>
              <Option
                label="Power chord · 2 ses"
                hint={toolHint(pen(2, penFret))}
                selected={sameTool(tool, pen(2, penFret))}
                testId="power-2"
                onClick={() => onPick(pen(2, penFret))}
              />
              <Option
                label="Power chord · 3 ses"
                hint={toolHint(pen(3, penFret))}
                selected={sameTool(tool, pen(3, penFret))}
                testId="power-3"
                onClick={() => onPick(pen(3, penFret))}
              />
              <div className="border-line flex items-center gap-2 rounded-lg border px-3 py-2">
                <span className="text-muted text-xs">Kök perde</span>
                <button
                  type="button"
                  data-pen-fret="down"
                  aria-label="Kök perdeyi bir azalt"
                  disabled={penFret <= 0}
                  onClick={() => onPick(pen(penVoices, Math.max(0, penFret - 1)))}
                  className="border-line text-text rounded-lg border disabled:opacity-40"
                  style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
                >
                  −
                </button>
                <span data-pen-fret-value className="text-text w-10 text-center tabular-nums">
                  {penFret}
                </span>
                <button
                  type="button"
                  data-pen-fret="up"
                  aria-label="Kök perdeyi bir artır"
                  disabled={penFret >= maxFret}
                  onClick={() => onPick(pen(penVoices, Math.min(maxFret, penFret + 1)))}
                  className="border-line text-text rounded-lg border disabled:opacity-40"
                  style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
                >
                  +
                </button>
              </div>
            </>
          ) : (
            <p role="status" className="text-muted text-sm">
              Bu enstrümanda şekil yazılamıyor.
            </p>
          )}
          <div className="border-line flex gap-2 border-t pt-3">
            <SheetButton
              data-composer-catalogue
              disabled={onOpenChordBuilder === null}
              onClick={() => onOpenChordBuilder?.(true)}
            >
              Diğer power chord şekilleri
            </SheetButton>
            <SheetButton
              disabled={onOpenChordBuilder === null}
              onClick={() => onOpenChordBuilder?.(false)}
            >
              Akor
            </SheetButton>
          </div>
          {onOpenChordBuilder === null ? (
            <p className="text-muted text-xs">
              Geniş şekil listesi için önce bir tele ve bir ana dokun.
            </p>
          ) : null}
        </div>
      ) : null}

      {door === "rhythm" ? (
        <div className="flex flex-col gap-2 pb-3">
          <Option
            label="Bu deseni devam ettir"
            hint="Seçtiğin bölümü olduğu gibi ya da taşıyarak tekrarlar."
            selected={tool.kind === "continue_pattern"}
            testId="continue"
            onClick={() => onPick({ kind: "continue_pattern", mode: "repeat" })}
          />
          <SheetButton
            data-composer-rhythm
            disabled={onOpenRhythm === null}
            onClick={() => onOpenRhythm?.()}
          >
            Ölçü ve ritim ızgarası
          </SheetButton>
        </div>
      ) : null}

      {door === "connect" ? (
        <div className="flex flex-col gap-2 pb-3" data-composer-connect>
          {(["auto", "hammer_on", "pull_off"] as const).map((connection) => {
            const option: ComposerTool = { kind: "connect", connection };
            return (
              <Option
                key={connection}
                label={
                  connection === "auto"
                    ? "Otomatik bağla"
                    : connection === "hammer_on"
                      ? "Çekiç (hammer-on)"
                      : "Koparma (pull-off)"
                }
                hint={toolHint(option)}
                selected={sameTool(tool, option)}
                testId={`connect-${connection}`}
                onClick={() => onPick(option)}
              />
            );
          })}
          <p className="text-muted pt-1 text-xs">
            Bağlamak için ilk notaya basılı tut ve parmağını son notaya kadar
            sürükle.
          </p>
        </div>
      ) : null}
    </Sheet>
  );
}

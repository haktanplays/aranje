"use client";

/**
 * What the hand does to the note (2V-C.1 §13, §14, §15).
 *
 * ## Two doors, and nothing behind them until one is opened
 *
 * A guitarist asks for one of two things: bend this note, or slide into it.
 * So the panel opens on exactly those two words, and the second level — how
 * far, which way, struck or not — appears only after one is chosen. A shelf
 * that showed all ten options at once would be a sheet with the lid off.
 *
 * ## It proposes; it does not write
 *
 * Every choice builds a draft Song and puts it on the grid as ghosts. The
 * canonical Song, the project store and the history are untouched until
 * "Uygula"; leaving the panel drops a reference. That is the same shape the
 * chord and transposition panels use, which is the point — one gesture, one
 * transaction, one undo.
 *
 * ## Only what this note can actually do
 *
 * The slide options are asked of the write command, not guessed: an option
 * that would be refused is shown greyed with the refusal's own sentence
 * beside it, so a reader learns why rather than pressing a dead control.
 */
import { useMemo, useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfPrimary,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import { measureLabel } from "@/lib/chords/chord-naming";
import { noteGestureSentence } from "@/lib/music/gesture-language";
import { resolveExpression } from "@/lib/music/expression-resolver";
import { applyGestureWrite } from "@/lib/song/gesture-write";
import type { EditTarget } from "@/lib/workspace/edit-target";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { NoteConnection, PitchGesture, Song } from "@/lib/song/schema";

/** How far. Two words, and the cents stay out of sight. */
const AMOUNTS = [
  { id: "half", label: "Yarım", cents: 100 },
  { id: "full", label: "Tam", cents: 200 },
] as const;

/** What the bend does. The four kinds, named as movements. */
const MOVES = [
  { id: "bend", label: "Yukarıda tut" },
  { id: "bend_release", label: "Geri indir" },
  { id: "prebend", label: "Önceden bük" },
  { id: "prebend_release", label: "Önceden bük ve indir" },
] as const;

/** Where the slide comes from or goes. */
const SLIDES = [
  { id: "legato", label: "Bağlı", spoken: "Hedef yeniden vurulmaz." },
  { id: "shift", label: "Vurarak", spoken: "Hedef yeniden vurulur." },
  { id: "in_below", label: "Aşağıdan gir", spoken: "Notaya aşağıdan kayarak girilir." },
  { id: "in_above", label: "Yukarıdan gir", spoken: "Notaya yukarıdan kayarak girilir." },
  { id: "out_down", label: "Aşağı çık", spoken: "Notadan aşağı kayarak çıkılır." },
  { id: "out_up", label: "Yukarı çık", spoken: "Notadan yukarı kayarak çıkılır." },
] as const;

type SlideId = (typeof SLIDES)[number]["id"];

/** What each slide option writes: a connection, or a gesture, never both. */
function slideCommand(id: SlideId): {
  readonly connection?: NoteConnection;
  readonly pitchGesture?: PitchGesture;
} {
  switch (id) {
    case "legato":
      return { connection: { kind: "legato_slide" } };
    case "shift":
      return { connection: { kind: "shift_slide" } };
    case "in_below":
      return { pitchGesture: { kind: "slide_in", from: "below" } };
    case "in_above":
      return { pitchGesture: { kind: "slide_in", from: "above" } };
    case "out_down":
      return { pitchGesture: { kind: "slide_out", to: "down" } };
    default:
      return { pitchGesture: { kind: "slide_out", to: "up" } };
  }
}

export function PlayingPanel({
  song,
  target,
  noteIndex,
  fret,
  draft,
  onPropose,
  onPreview,
  onApply,
}: {
  song: Song;
  target: EditTarget;
  /** Which voice of the onset the reader is holding. */
  noteIndex: number;
  /** The fret written here, or null when the cell is empty. */
  fret: number | null;
  draft: EditDraft | null;
  onPropose: (next: EditDraft) => void;
  onPreview: (candidate: Song) => void;
  onApply: (proposal: EditDraft) => void;
}) {
  const [door, setDoor] = useState<"bend" | "slide" | null>(null);
  const [cents, setCents] = useState(200);
  const [move, setMove] = useState<(typeof MOVES)[number]["id"]>("bend");
  const [shake, setShake] = useState(false);
  const [slide, setSlide] = useState<SlideId | null>(null);

  const base = {
    sectionId: target.sectionId,
    trackId: target.trackId,
    timeTicks: target.sectionTicks,
    noteIndex,
  };

  /** Try a command without keeping it: what the reader would get. */
  const attempt = (command: Parameters<typeof applyGestureWrite>[1]) =>
    applyGestureWrite(song, command);

  /*
   * Which slide options this note can actually take. Asked of the write, so
   * an option that is offered is one that will work and an option that is
   * greyed carries the reason the write itself would have given.
   */
  const slideOffers = useMemo(
    () =>
      SLIDES.map((entry) => {
        const result = attempt({ ...base, ...slideCommand(entry.id) });
        return {
          ...entry,
          ok: result.ok,
          reason: result.ok ? undefined : result.message,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song, target.sectionTicks, target.trackId, target.sectionId, noteIndex],
  );

  const bendGesture: PitchGesture = {
    kind: move,
    targetCents: cents,
    ...(shake
      ? { vibrato: { startAfterTarget: true as const, depthCents: 20, rateHz: 5 } }
      : {}),
  };

  const chosen =
    door === "bend"
      ? { pitchGesture: bendGesture }
      : slide
        ? slideCommand(slide)
        : null;

  const result = chosen ? attempt({ ...base, ...chosen }) : null;

  /** What the reader will hear, in the same words the tab will speak. */
  const sentence = chosen
    ? noteGestureSentence({
        fret,
        reading: resolveExpression(chosen),
      })
    : null;

  const stage = (): EditDraft | null => {
    if (!result || !result.ok || !sentence) return null;
    return {
      song: result.song,
      ghost: {
        sectionId: target.sectionId,
        trackId: target.trackId,
        fromTicks: target.sectionTicks,
        toTicks: target.sectionTicks + Math.max(target.currentTicks, target.slotTicks),
        onsetTicks: [target.sectionTicks],
      },
      summary: `${sentence} · ${measureLabel(target.barNumber)}`,
      label: door === "bend" ? "Bend yaz" : "Kaydırma yaz",
    };
  };

  const refusal =
    fret === null
      ? "Önce bir nota yaz."
      : chosen === null
        ? "Bend mi, kaydırma mı?"
        : result && !result.ok
          ? result.message
          : null;

  return (
    <div className="flex flex-col gap-2" data-panel="playing">
      <ShelfNote testId="playing-where">
        {measureLabel(target.barNumber)}
        {fret === null ? "" : ` · ${fret}. perde`}
      </ShelfNote>

      <ShelfRow label="Ne yapsın?" testId="door">
        <ShelfChoice
          testId="door-bend"
          label="Bend"
          active={door === "bend"}
          reason={fret === null ? "Önce bir nota yaz." : undefined}
          onPress={() => {
            setDoor(door === "bend" ? null : "bend");
            setSlide(null);
          }}
        />
        <ShelfChoice
          testId="door-slide"
          label="Kaydır"
          active={door === "slide"}
          reason={fret === null ? "Önce bir nota yaz." : undefined}
          onPress={() => setDoor(door === "slide" ? null : "slide")}
        />
      </ShelfRow>

      {door === "bend" ? (
        <>
          <ShelfRow label="Ne kadar?" testId="amount">
            {AMOUNTS.map((entry) => (
              <ShelfChoice
                key={entry.id}
                testId={`amount-${entry.id}`}
                label={entry.label}
                active={cents === entry.cents}
                onPress={() => setCents(entry.cents)}
              />
            ))}
          </ShelfRow>

          <ShelfRow label="Hareket" testId="move">
            {MOVES.map((entry) => (
              <ShelfChoice
                key={entry.id}
                testId={`move-${entry.id}`}
                label={entry.label}
                active={move === entry.id}
                onPress={() => setMove(entry.id)}
              />
            ))}
          </ShelfRow>

          <ShelfRow label="Üstüne" testId="shake">
            <ShelfChoice
              testId="shake-top"
              label="Tepede vibrato"
              active={shake}
              onPress={() => setShake((on) => !on)}
            />
          </ShelfRow>
        </>
      ) : null}

      {door === "slide" ? (
        <ShelfRow label="Nasıl?" testId="slide">
          {slideOffers.map((entry) => (
            <ShelfChoice
              key={entry.id}
              testId={`slide-${entry.id}`}
              label={entry.label}
              spoken={entry.spoken}
              active={slide === entry.id}
              reason={entry.reason}
              onPress={() => setSlide(slide === entry.id ? null : entry.id)}
            />
          ))}
        </ShelfRow>
      ) : null}

      {/* The gesture in the same sentence the tab will speak, so what the
          reader chose and what the page will say cannot disagree. */}
      {sentence && result?.ok ? (
        <ShelfNote testId="playing-reading">{sentence}</ShelfNote>
      ) : null}

      {refusal ? (
        <ShelfNote tone="warn" testId="playing-refusal">
          {refusal}
        </ShelfNote>
      ) : null}

      {draft ? <ShelfNote testId="staged">{draft.summary} · önizleme</ShelfNote> : null}

      <div className="flex gap-1.5" data-panel-actions="playing">
        <ShelfSecondary
          testId="listen"
          label="Dinle"
          reason={refusal ?? undefined}
          onPress={() => {
            const next = stage();
            if (!next) return;
            onPropose(next);
            onPreview(next.song);
          }}
        />
        <ShelfPrimary
          testId="apply"
          label="Uygula"
          reason={refusal ?? undefined}
          onPress={() => {
            const next = stage();
            if (next) onApply(next);
          }}
        />
      </div>
    </div>
  );
}

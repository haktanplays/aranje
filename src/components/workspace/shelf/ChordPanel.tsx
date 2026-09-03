"use client";

/**
 * A chord as one intention (2V-B.4 §12, §13, §14).
 *
 * ## Not six strings, one chord
 *
 * A reader who wants an A minor should not have to know which fret goes on
 * which string, and should certainly not have to fill six of them one at a
 * time. They choose a root, a quality and how long it lasts; the app proposes
 * a shape a hand can hold; they hear it and keep it. One user intention, one
 * atomic transaction.
 *
 * ## Power chord keeps its own door
 *
 * The founder likes the power chord flow and it is not touched: it stays the
 * quick option it already is. What is here is the *ordinary* chord, which had
 * no comparable path.
 *
 * ## One name
 *
 * The chord is named by `chord-naming`, spelled for the song's own key, and
 * that name appears once. No enum, no second spelling, no "C minor" beside
 * "C minör".
 */
import { useMemo, useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfPrimary,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import { applyChordWrite } from "@/lib/chords/chord-command";
import {
  ADVANCED_QUALITIES,
  SIMPLE_QUALITIES,
  chordDisplayName,
  measureLabel,
  qualityLabel,
  spellPitchClass,
} from "@/lib/chords/chord-naming";
import { chordSpanOffers, defaultChordSpan, type ChordSpanId } from "@/lib/chords/chord-span";
import { chordVoicings } from "@/lib/chords/chord-voicing";
import {
  recommendVoicings,
  VOICING_ANGLE_LABEL,
} from "@/lib/chords/voicing-recommendation";
import { ROOT_PITCH_CLASSES } from "@/lib/chords/chord-formula";
import type { EditTarget } from "@/lib/workspace/edit-target";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { Song, Track } from "@/lib/song/schema";

export function ChordPanel({
  song,
  track,
  target,
  selectionEndTicks,
  onPropose,
  onPreview,
  onApply,
}: {
  song: Song;
  track: Track;
  target: EditTarget;
  /** The held range's end, in section ticks, when there is one. */
  selectionEndTicks: number | null;
  onPropose: (draft: EditDraft) => void;
  onPreview: (candidate: Song) => void;
  onApply: (proposal: EditDraft) => void;
}) {
  const [root, setRoot] = useState(0);
  const [quality, setQuality] = useState(SIMPLE_QUALITIES[1]!);
  const [advanced, setAdvanced] = useState(false);
  const [angle, setAngle] = useState(0);

  const spans = useMemo(
    () =>
      chordSpanOffers({
        startTicks: target.sectionTicks,
        beatTicks: target.beatTicks,
        measureEndTicks:
          target.sectionTicks - target.startTicks + target.barTicks,
        nextOnsetTicks:
          target.nextOnsetTicks === null
            ? null
            : target.sectionTicks - target.startTicks + target.nextOnsetTicks,
        selectionEndTicks,
      }),
    [selectionEndTicks, target],
  );
  const [spanId, setSpanId] = useState<ChordSpanId>(() =>
    defaultChordSpan({
      startTicks: target.sectionTicks,
      beatTicks: target.beatTicks,
      measureEndTicks: target.barTicks,
      nextOnsetTicks: null,
      selectionEndTicks,
    }),
  );
  const span = spans.find((offer) => offer.id === spanId) ?? spans[0]!;

  const offered = useMemo(
    () => chordVoicings({ track, rootPitchClass: root, quality }),
    [quality, root, track],
  );
  const pick = useMemo(
    () => (offered.ok ? recommendVoicings(offered.voicings) : null),
    [offered],
  );
  const choices = pick ? [pick.recommended, ...pick.alternatives.map((entry) => entry.voicing)] : [];
  const chosen = choices[Math.min(angle, choices.length - 1)] ?? null;

  const proposal = useMemo(() => {
    if (!chosen || span.ticks === null || span.ticks <= 0) return null;
    const written = applyChordWrite(song, {
      sectionId: target.sectionId,
      trackId: target.trackId,
      timeTicks: target.sectionTicks,
      durationTicks: span.ticks,
      voicing: chosen,
      velocity: 96,
      mode: "insert",
    });
    if (written.ok) return { song: written.song, replace: false };
    const replaced = applyChordWrite(song, {
      sectionId: target.sectionId,
      trackId: target.trackId,
      timeTicks: target.sectionTicks,
      durationTicks: span.ticks,
      voicing: chosen,
      velocity: 96,
      mode: "replace_onset",
    });
    return replaced.ok ? { song: replaced.song, replace: true } : null;
  }, [chosen, song, span.ticks, target]);

  const name = chordDisplayName({ rootPitchClass: root, quality }, song.key);

  const stage = (): EditDraft | null => {
    if (!proposal || span.ticks === null) return null;
    return {
      song: proposal.song,
      ghost: {
        sectionId: target.sectionId,
        trackId: target.trackId,
        fromTicks: target.sectionTicks,
        toTicks: target.sectionTicks + span.ticks,
        onsetTicks: [target.sectionTicks],
      },
      summary: `${name} · ${measureLabel(target.barNumber)}`,
      label: proposal.replace ? "Akoru değiştir" : "Akor ekle",
    };
  };

  const refusal = !offered.ok
    ? "Bu enstrümanda bu akor çalınamıyor."
    : chosen === null
      ? "Bu akor için çalınabilir bir şekil bulunamadı."
      : proposal === null
        ? "Bu süre buraya sığmıyor; daha kısa bir süre seç."
        : null;

  const qualities = advanced ? [...SIMPLE_QUALITIES, ...ADVANCED_QUALITIES] : SIMPLE_QUALITIES;

  return (
    <div className="flex flex-col gap-2" data-panel="chord">
      <ShelfNote testId="chord-name">
        {name} · {measureLabel(target.barNumber)}
      </ShelfNote>

      <ShelfRow label="Kök" testId="root">
        {ROOT_PITCH_CLASSES.map((pitchClass) => (
          <ShelfChoice
            key={pitchClass}
            testId={`root-${pitchClass}`}
            label={spellPitchClass(pitchClass, song.key)}
            active={root === pitchClass}
            onPress={() => setRoot(pitchClass)}
          />
        ))}
      </ShelfRow>

      <ShelfRow label="Tür" testId="quality">
        {qualities.map((entry) => (
          <ShelfChoice
            key={entry}
            testId={`quality-${entry}`}
            label={qualityLabel(entry)}
            active={quality === entry}
            onPress={() => setQuality(entry)}
          />
        ))}
      </ShelfRow>

      <ShelfRow label="Ne kadar sürsün?" testId="span">
        {spans.map((offer) => (
          <ShelfChoice
            key={offer.id}
            testId={`span-${offer.id}`}
            label={offer.label}
            active={spanId === offer.id}
            reason={offer.reason}
            onPress={() => setSpanId(offer.id)}
          />
        ))}
      </ShelfRow>

      {choices.length > 1 ? (
        <ShelfRow label="Şekil" testId="shape">
          {choices.map((voicing, index) => (
            <ShelfChoice
              key={voicing.id}
              testId={`shape-${index}`}
              label={
                index === 0
                  ? "Önerilen"
                  : (() => {
                      const alternative = pick?.alternatives[index - 1];
                      return alternative
                        ? VOICING_ANGLE_LABEL[alternative.angle]
                        : `Seçenek ${index}`;
                    })()
              }
              active={angle === index}
              onPress={() => setAngle(index)}
            />
          ))}
        </ShelfRow>
      ) : null}

      {refusal ? <ShelfNote tone="warn" testId="chord-refusal">{refusal}</ShelfNote> : null}

      <div className="flex items-center gap-1.5" data-panel-actions="chord">
        <ShelfSecondary
          testId="advanced"
          label="Ayrıntılar"
          active={advanced}
          onPress={() => setAdvanced((open) => !open)}
        />
        <ShelfSecondary
          testId="listen"
          label="Dinle"
          reason={proposal ? undefined : (refusal ?? "Önce bir akor seç.")}
          onPress={() => {
            const next = stage();
            if (!next) return;
            onPropose(next);
            onPreview(next.song);
          }}
        />
        <ShelfPrimary
          testId="apply"
          label={proposal?.replace ? "Uygula" : "Ekle"}
          reason={proposal ? undefined : (refusal ?? "Önce bir akor seç.")}
          onPress={() => {
            const next = stage();
            if (next) onApply(next);
          }}
        />
      </div>
    </div>
  );
}

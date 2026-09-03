"use client";

/**
 * Two intentions, two rows (2V-B.4 §15, §16).
 *
 * "Sesi taşı" moves what is held by an interval. "Tonu değiştir" puts a
 * scope into another key. They are separate because they answer different
 * questions and have different consequences — the second one is the only one
 * that may rewrite the song's key metadata, and then only when its scope is
 * the whole song.
 *
 * A result that cannot be played is never applied quietly: the domain refuses
 * with a sentence naming the note, and that sentence is what the reader sees.
 */
import { useState } from "react";

import {
  ShelfChoice,
  ShelfNote,
  ShelfPrimary,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import {
  KEY_CHOICES,
  PITCH_MOVES,
  TRANSPOSE_SCOPES,
  TRANSPOSE_SCOPE_LABEL,
  semitonesBetween,
  transposeSong,
  type TransposeScope,
  type TransposeTarget,
} from "@/lib/song/transpose";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { Song } from "@/lib/song/schema";

export function TransposePanel({
  song,
  /** What the reader is holding, if anything. */
  selection,
  sectionId,
  trackId,
  onPreview,
  onApply,
}: {
  song: Song;
  selection: { readonly startTicks: number; readonly endTicks: number } | null;
  sectionId: string;
  trackId: string;
  onPreview: (candidate: Song) => void;
  onApply: (proposal: EditDraft) => void;
}) {
  const [scope, setScope] = useState<TransposeScope>(selection ? "selection" : "song");
  const [key, setKey] = useState(song.key);
  const [error, setError] = useState<string | null>(null);
  const [restrung, setRestrung] = useState(0);

  const targetOf = (which: TransposeScope): TransposeTarget =>
    which === "song"
      ? { scope: "song" }
      : which === "section"
        ? { scope: "section", sectionId }
        : {
            scope: "selection",
            sectionId,
            trackId,
            fromTicks: selection?.startTicks ?? 0,
            toTicks: selection?.endTicks ?? 0,
          };

  const run = (semitones: number, nextKey: string | undefined, label: string) => {
    setError(null);
    const result = transposeSong(song, {
      semitones,
      target: targetOf(scope),
      ...(nextKey === undefined ? {} : { nextKey }),
    });
    if (!result.ok) {
      setError(result.error.message);
      setRestrung(0);
      return null;
    }
    setRestrung(result.restrung);
    return {
      song: result.song,
      ghost: {
        sectionId,
        trackId,
        fromTicks: selection?.startTicks ?? 0,
        toTicks: selection?.endTicks ?? 0,
        onsetTicks: [],
      },
      summary: label,
      label,
    } satisfies EditDraft;
  };

  const scopeReason = (which: TransposeScope) =>
    which === "selection" && !selection ? "Şu an seçili bir alan yok." : undefined;

  const keyDistance = semitonesBetween(song.key, key);

  return (
    <div className="flex flex-col gap-2" data-panel="transpose">
      <ShelfRow label="Neyi?" testId="scope">
        {TRANSPOSE_SCOPES.map((option) => (
          <ShelfChoice
            key={option}
            testId={`scope-${option}`}
            label={TRANSPOSE_SCOPE_LABEL[option]}
            active={scope === option}
            reason={scopeReason(option)}
            onPress={() => setScope(option)}
          />
        ))}
      </ShelfRow>

      <ShelfRow label="Sesi taşı" testId="move">
        {PITCH_MOVES.map((move) => (
          <ShelfChoice
            key={move.id}
            testId={`move-${move.id}`}
            label={move.label}
            onPress={() => {
              const draft = run(move.semitones, undefined, move.label);
              if (draft) onApply(draft);
            }}
          />
        ))}
      </ShelfRow>

      <ShelfRow label="Tonu değiştir" testId="key">
        {KEY_CHOICES.map((choice) => (
          <ShelfChoice
            key={choice}
            testId={`key-${choice.replace(/\s+/gu, "-")}`}
            label={choice}
            active={key === choice}
            onPress={() => setKey(choice)}
          />
        ))}
      </ShelfRow>

      {error ? <ShelfNote tone="warn" testId="transpose-error">{error}</ShelfNote> : null}
      {restrung > 0 ? (
        <ShelfNote testId="restrung">
          {restrung} nota çalınabilir kalmak için komşu tele taşındı.
        </ShelfNote>
      ) : null}

      <div className="flex gap-1.5" data-panel-actions="transpose">
        <ShelfSecondary
          testId="listen"
          label="Dinle"
          reason={keyDistance === null || keyDistance === 0 ? "Önce farklı bir ton seç." : undefined}
          onPress={() => {
            const draft = run(keyDistance ?? 0, key, `Ton: ${key}`);
            if (draft) onPreview(draft.song);
          }}
        />
        <ShelfPrimary
          testId="apply-key"
          label={`${key} yap`}
          reason={
            keyDistance === null || keyDistance === 0
              ? "Şarkı zaten bu tonda."
              : undefined
          }
          onPress={() => {
            const draft = run(keyDistance ?? 0, key, `Ton: ${key}`);
            if (draft) onApply(draft);
          }}
        />
      </div>
    </div>
  );
}

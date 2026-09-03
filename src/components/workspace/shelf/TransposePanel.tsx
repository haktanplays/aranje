"use client";

/**
 * Two intentions, and neither of them writes until the reader says so
 * (2V-B.4 Completion §14, §15, §16).
 *
 * ## Sesi taşı
 *
 * Move what is held by an interval. The scope is not a control: it is
 * whatever the reader selected, and the panel says which — Nota, Akor, Seçili
 * alan or Şarkı — rather than asking a question they already answered.
 *
 * ## Başka tona…
 *
 * Put a scope into another key. Only this one may rewrite the song's key
 * metadata, and only when its scope is the whole song. A selection asked to
 * do it is refused by the domain, not by a disabled control.
 *
 * ## Nothing is written until "Uygula"
 *
 * Both intentions build a **draft song** and put it on the grid as amber
 * ghosts. The canonical Song, the ledger and the project store are untouched
 * until the reader keeps it; leaving the panel drops a reference. That is the
 * same shape every other panel in this shelf uses, which is the point.
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
  pitchMoveScopeLabel,
  semitonesBetween,
  transposeSong,
  type TransposeScope,
  type TransposeTarget,
} from "@/lib/song/transpose";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { Song } from "@/lib/song/schema";

export function TransposePanel({
  song,
  selection,
  sectionId,
  trackId,
  voices,
  draft,
  onPropose,
  onPreview,
  onApply,
}: {
  song: Song;
  /** What the reader is holding, if anything. */
  selection: { readonly startTicks: number; readonly endTicks: number } | null;
  sectionId: string;
  trackId: string;
  /** How many voices the held moment has, so the scope can name itself. */
  voices: number;
  draft: EditDraft | null;
  onPropose: (next: EditDraft) => void;
  onPreview: (candidate: Song) => void;
  onApply: (proposal: EditDraft) => void;
}) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [scope, setScope] = useState<TransposeScope>(selection ? "selection" : "song");
  const [key, setKey] = useState(song.key);
  const [error, setError] = useState<string | null>(null);
  const [restrung, setRestrung] = useState(0);

  const held = pitchMoveScopeLabel({ hasSelection: selection !== null, voices });

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

  /** Build the song as it would be, and never anything else. */
  const stage = (
    semitones: number,
    which: TransposeScope,
    nextKey: string | undefined,
    label: string,
  ): EditDraft | null => {
    setError(null);
    const result = transposeSong(song, {
      semitones,
      target: targetOf(which),
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
        fromTicks: which === "selection" ? (selection?.startTicks ?? 0) : 0,
        toTicks:
          which === "selection"
            ? (selection?.endTicks ?? 0)
            : Number.MAX_SAFE_INTEGER,
        onsetTicks: [],
      },
      summary: label,
      label,
    };
  };

  const moveScope: TransposeScope = selection ? "selection" : "song";
  const keyDistance = semitonesBetween(song.key, key);

  return (
    <div className="flex flex-col gap-2" data-panel="transpose">
      <ShelfNote testId="transpose-scope">Taşınacak: {held}</ShelfNote>

      <ShelfRow label="Sesi taşı" testId="move">
        {PITCH_MOVES.map((move) => (
          <ShelfChoice
            key={move.id}
            testId={`move-${move.id}`}
            label={move.label}
            active={draft?.label === move.label}
            onPress={() => {
              const next = stage(move.semitones, moveScope, undefined, move.label);
              /* Proposed, not written: it goes on the grid in amber and the
                 reader decides (§14). */
              if (next) onPropose(next);
            }}
          />
        ))}
      </ShelfRow>

      <ShelfRow label="Başka tona…" testId="key-door">
        <ShelfChoice
          testId="open-key"
          label={keyOpen ? "Kapat" : "Başka tona…"}
          active={keyOpen}
          onPress={() => setKeyOpen((open) => !open)}
        />
      </ShelfRow>

      {keyOpen ? (
        <>
          <ShelfRow label="Neyi?" testId="scope">
            {TRANSPOSE_SCOPES.map((option) => (
              <ShelfChoice
                key={option}
                testId={`scope-${option}`}
                label={TRANSPOSE_SCOPE_LABEL[option]}
                active={scope === option}
                reason={
                  option === "selection" && !selection
                    ? "Şu an seçili bir alan yok."
                    : undefined
                }
                onPress={() => setScope(option)}
              />
            ))}
          </ShelfRow>

          <ShelfRow label="Hangi ton?" testId="key">
            {KEY_CHOICES.map((choice) => (
              <ShelfChoice
                key={choice}
                testId={`key-${choice.replace(/\s+/gu, "-")}`}
                label={choice}
                active={key === choice}
                onPress={() => {
                  setKey(choice);
                  const distance = semitonesBetween(song.key, choice);
                  if (distance === null || distance === 0) return;
                  const next = stage(distance, scope, choice, `Ton: ${choice}`);
                  if (next) onPropose(next);
                }}
              />
            ))}
          </ShelfRow>
        </>
      ) : null}

      {error ? <ShelfNote tone="warn" testId="transpose-error">{error}</ShelfNote> : null}
      {restrung > 0 ? (
        <ShelfNote testId="restrung">
          {restrung} nota çalınabilir kalmak için komşu tele taşındı.
        </ShelfNote>
      ) : null}
      {draft ? <ShelfNote testId="staged">{draft.summary} · önizleme</ShelfNote> : null}

      <div className="flex gap-1.5" data-panel-actions="transpose">
        <ShelfSecondary
          testId="listen"
          label="Dinle"
          reason={draft ? undefined : "Önce bir taşıma seç."}
          onPress={() => {
            if (draft) onPreview(draft.song);
          }}
        />
        <ShelfPrimary
          testId="apply"
          label="Uygula"
          reason={
            draft
              ? undefined
              : keyOpen && keyDistance === 0
                ? "Şarkı zaten bu tonda."
                : "Önce bir taşıma seç."
          }
          onPress={() => {
            if (draft) onApply(draft);
          }}
        />
      </div>
    </div>
  );
}

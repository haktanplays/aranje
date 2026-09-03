"use client";

/**
 * Naming an idea, in the shelf (2V-B.4 §10, §11).
 *
 * The four words this panel keeps apart, because the app used to use one for
 * all of them: a **measure** is the meter's division, a **grid** is what is on
 * the screen, a **selection** is what the reader is holding right now, and a
 * **phrase** is a stretch of music that is one idea and stays one after the
 * finger is lifted.
 *
 * So this panel is the one place the two temporary things become the
 * permanent one. It names what is held; it does not draw phrases (the band
 * above the staff does) and it is not a phrase editor — there is no dragging
 * a boundary here, and none is offered rather than half-offered.
 */
import {
  ShelfNote,
  ShelfPrimary,
  ShelfRow,
  ShelfSecondary,
} from "@/components/workspace/shelf/ShelfControls";
import { measureLabel } from "@/lib/chords/chord-naming";
import { phraseAt } from "@/lib/song/phrase";
import { namePhrase, removePhrase } from "@/lib/song/phrase-write";
import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { Song } from "@/lib/song/schema";

export function PhrasePanel({
  song,
  sectionId,
  trackId,
  selection,
  barNumber,
  onApply,
}: {
  song: Song;
  sectionId: string;
  trackId: string;
  /** The held range in section ticks, or null when nothing is held. */
  selection: { readonly startTicks: number; readonly endTicks: number } | null;
  /** Which measure the range starts in, said the way a musician says it. */
  barNumber: number;
  onApply: (proposal: EditDraft) => void;
}) {
  const section = song.sections.find((entry) => entry.id === sectionId);
  const existing = selection
    ? phraseAt(section?.phrases, selection.startTicks)
    : null;

  const ghostOf = (from: number, to: number) => ({
    sectionId,
    trackId,
    fromTicks: from,
    toTicks: to,
    onsetTicks: [] as readonly number[],
  });

  const create = () => {
    if (!selection) return;
    const result = namePhrase(song, {
      sectionId,
      fromTicks: selection.startTicks,
      toTicks: selection.endTicks,
    });
    if (!result.ok) return;
    onApply({
      song: result.song,
      ghost: ghostOf(selection.startTicks, selection.endTicks),
      summary: `${measureLabel(barNumber)} · cümle`,
      label: "Cümle adlandır",
    });
  };

  const drop = () => {
    if (!existing) return;
    const result = removePhrase(song, { sectionId, phraseId: existing.id });
    if (!result.ok) return;
    onApply({
      song: result.song,
      ghost: ghostOf(existing.startTicks, existing.endTicks),
      summary: existing.name ?? "Cümle",
      label: "Cümle adını kaldır",
    });
  };

  const refusal = !selection
    ? "Önce adlandıracağın alanı seç."
    : selection.endTicks <= selection.startTicks
      ? "Seçili alan boş."
      : existing
        ? null
        : namePhrase(song, {
              sectionId,
              fromTicks: selection.startTicks,
              toTicks: selection.endTicks,
            }).ok
          ? null
          : "Burası başka bir cümlenin içinde kalıyor.";

  return (
    <div className="flex flex-col gap-2" data-panel="phrase">
      <ShelfNote testId="phrase-where">
        {existing
          ? `${existing.name ?? "Cümle"} · ${measureLabel(barNumber)}`
          : `${measureLabel(barNumber)} · adsız`}
      </ShelfNote>

      <ShelfRow label="Ne işe yarar?" testId="phrase-why">
        <ShelfNote testId="phrase-hint">
          Cümle kalıcıdır; seçim geçicidir. Ölçü sınırını aşabilir.
        </ShelfNote>
      </ShelfRow>

      {refusal ? <ShelfNote tone="warn" testId="phrase-refusal">{refusal}</ShelfNote> : null}

      <div className="flex gap-1.5" data-panel-actions="phrase">
        {existing ? (
          <ShelfSecondary testId="drop-phrase" label="Adı kaldır" onPress={drop} />
        ) : null}
        <ShelfPrimary
          testId="name-phrase"
          label="Cümle yap"
          reason={refusal ?? (existing ? "Bu alan zaten adlandırılmış." : undefined)}
          onPress={create}
        />
      </div>
    </div>
  );
}

"use client";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { ARRANGE_SKILLS, type ArrangeSkill } from "@/lib/copilot/contract";
import { STYLE_CARD_IDS } from "@/lib/copilot/style-cards";
import { targetsFor } from "@/lib/copilot/ui-options";
import type { Song } from "@/lib/song/schema";

const SKILL_LABEL: Readonly<Record<ArrangeSkill, string>> = {
  rhythm_guitar: "Ritim gitar",
  lead_guitar: "Solo gitar",
  acoustic_guitar: "Akustik gitar",
  harmony: "Armoni gitar",
  bass: "Bas",
  drums: "Davul",
};

const STYLE_LABEL: Readonly<Record<string, string>> = {
  "generic-metal": "Metal doku",
  "progressive-atmospheric-acoustic": "Atmosferik akustik",
};

export type ArrangeForm = {
  sectionId: string;
  skill: ArrangeSkill;
  targetTrackId: string;
  styleId: string | null;
  instruction: string;
};

/**
 * Asking for an arrangement (spec 13.1, 13.2).
 *
 * The tab surface stays a tab: every choice is made here, in a sheet. The
 * target list is derived from the skill, so an incompatible track is never
 * offered; there is no control for the locked list, because it is not the
 * reader's to widen.
 */
export function ArrangeSheet({
  open,
  song,
  form,
  onChange,
  onClose,
  onSubmit,
  submitting,
  demo,
  error,
}: {
  open: boolean;
  song: Song;
  form: ArrangeForm;
  onChange: (next: ArrangeForm) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  /** True when the deterministic demo path is the one that will answer. */
  demo: boolean;
  error: string | null;
}) {
  const targets = targetsFor(song, form.skill);
  const ready = targets.some((target) => target.id === form.targetTrackId);

  return (
    <Sheet
      open={open}
      title="Aranje et"
      onClose={onClose}
      labelledBy="arrange-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={onClose}>Vazgeç</SheetButton>
          <SheetButton
            tone="primary"
            onClick={onSubmit}
            disabled={submitting || !ready}
          >
            {submitting ? "Hazırlanıyor…" : "Öneri iste"}
          </SheetButton>
        </div>
      }
    >
      {demo ? (
        <p className="border-bronze/60 bg-bronze/10 text-bronze mb-3 rounded-lg border px-3 py-2 text-xs">
          <span className="font-semibold">Demo</span> — bu sonuç deterministik
          bir örnektir, yapay zekâ üretmez.
        </p>
      ) : null}

      <fieldset className="pb-3">
        <legend className="text-muted pb-2 text-xs tracking-wide uppercase">
          Bölüm
        </legend>
        <div className="flex flex-wrap gap-2">
          {song.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-pressed={form.sectionId === section.id}
              onClick={() => onChange({ ...form, sectionId: section.id })}
              className={`min-h-11 rounded-lg border px-3 text-sm ${
                form.sectionId === section.id
                  ? "border-steel text-steel"
                  : "border-line text-muted"
              }`}
            >
              {section.name}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="border-line border-t pt-3 pb-3">
        <legend className="text-muted pb-2 text-xs tracking-wide uppercase">
          Ne yazılsın
        </legend>
        <div className="flex flex-wrap gap-2">
          {ARRANGE_SKILLS.map((skill) => {
            const options = targetsFor(song, skill);
            return (
              <button
                key={skill}
                type="button"
                aria-pressed={form.skill === skill}
                disabled={options.length === 0}
                onClick={() =>
                  onChange({
                    ...form,
                    skill,
                    targetTrackId: options[0]?.id ?? "",
                  })
                }
                className={`min-h-11 rounded-lg border px-3 text-sm disabled:opacity-40 ${
                  form.skill === skill
                    ? "border-steel text-steel"
                    : "border-line text-muted"
                }`}
              >
                {SKILL_LABEL[skill]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="border-line border-t pt-3 pb-3">
        <legend className="text-muted pb-2 text-xs tracking-wide uppercase">
          Hedef track
        </legend>
        {targets.length === 0 ? (
          <p className="text-muted text-sm">
            Bu şarkıda bu iş için uygun bir track yok.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                aria-pressed={form.targetTrackId === target.id}
                onClick={() => onChange({ ...form, targetTrackId: target.id })}
                className={`min-h-11 rounded-lg border px-3 text-sm ${
                  form.targetTrackId === target.id
                    ? "border-steel text-steel"
                    : "border-line text-muted"
                }`}
              >
                {target.name}
              </button>
            ))}
          </div>
        )}
        <p className="text-muted/70 pt-2 text-xs">
          Diğer bütün track&apos;ler bu istek boyunca kilitli kalır.
        </p>
      </fieldset>

      <fieldset className="border-line border-t pt-3 pb-3">
        <legend className="text-muted pb-2 text-xs tracking-wide uppercase">
          Doku
        </legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={form.styleId === null}
            onClick={() => onChange({ ...form, styleId: null })}
            className={`min-h-11 rounded-lg border px-3 text-sm ${
              form.styleId === null
                ? "border-steel text-steel"
                : "border-line text-muted"
            }`}
          >
            Yok
          </button>
          {STYLE_CARD_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={form.styleId === id}
              onClick={() => onChange({ ...form, styleId: id })}
              className={`min-h-11 rounded-lg border px-3 text-sm ${
                form.styleId === id
                  ? "border-steel text-steel"
                  : "border-line text-muted"
              }`}
            >
              {STYLE_LABEL[id] ?? id}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="border-line border-t pt-3 pb-2">
        <label
          htmlFor="arrange-instruction"
          className="text-muted block pb-2 text-xs tracking-wide uppercase"
        >
          Notun (isteğe bağlı)
        </label>
        <textarea
          id="arrange-instruction"
          value={form.instruction}
          onChange={(event) =>
            onChange({ ...form, instruction: event.target.value })
          }
          rows={2}
          maxLength={2000}
          placeholder="Örnek: daha az nota, daha çok boşluk"
          className="bg-raised w-full rounded-lg border border-line px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p role="alert" className="text-reject pb-2 text-sm">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

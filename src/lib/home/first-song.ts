/**
 * What "Yeni parça" means, in one place (2V-E.1 §3, §5).
 *
 * The journey has a shape — open Home, tap once, be in the editor with music
 * you can write on — and the thing that makes it one tap rather than a form
 * is that every choice already has a safe answer. This file is that set of
 * answers, and it is a *table* rather than a builder: the song itself is
 * still made by `materializeTemplate`, which is the one place a Song comes
 * from, so a default written here cannot drift away from the song a template
 * actually produces.
 *
 * They are visible assumptions, not hidden ones. The Home screen shows them
 * before the reader commits, and "Ayarları değiştir" is the door to the
 * template list for a reader who wants a different starting band.
 */
import { getInstrument } from "@/lib/instruments/registry";
import { presetName } from "@/lib/instruments/labels";
import { NEW_PROJECT_TITLE } from "@/lib/projects/project-names";
import { playableCorePresets } from "@/lib/audio/preset-availability";
import { SONG_TEMPLATES, TEMPLATE_DEFAULTS, type SongTemplateId } from "@/lib/song/song-templates";

/** The template one tap starts from: one guitar, nothing else in the way. */
export const FIRST_SONG_TEMPLATE: SongTemplateId = "empty";

export type StartingAssumption = {
  /** What the row is about, in the reader's words. */
  readonly label: string;
  /** What it will be if they do nothing. */
  readonly value: string;
};

/**
 * The assumptions a one-tap start is making, read off the template.
 *
 * Derived rather than typed out twice: if the template's first track stops
 * being a high-gain guitar, this row says so on the next render instead of
 * telling the reader something that used to be true.
 */
export function startingAssumptions(
  templateId: SongTemplateId = FIRST_SONG_TEMPLATE,
): readonly StartingAssumption[] {
  const template = SONG_TEMPLATES.find((entry) => entry.id === templateId);
  const plan = template?.trackPlans[0];
  const instrument = plan ? getInstrument(plan.instrumentId) : undefined;
  const preset = plan ? playableCorePresets(plan.instrumentId)[0] : undefined;

  const rows: StartingAssumption[] = [
    { label: "Ad", value: NEW_PROJECT_TITLE },
    { label: "Ton", value: TEMPLATE_DEFAULTS.key },
    { label: "Tempo", value: `${TEMPLATE_DEFAULTS.bpm} BPM` },
    {
      label: "Ölçü",
      value: `${TEMPLATE_DEFAULTS.timeSignature[0]}/${TEMPLATE_DEFAULTS.timeSignature[1]}`,
    },
    {
      label: "İlk bölüm",
      value: `${TEMPLATE_DEFAULTS.sectionName} · ${TEMPLATE_DEFAULTS.barCount} ölçü`,
    },
  ];
  if (plan && instrument) {
    const sound = preset ? presetName(plan.instrumentId, preset.id) : null;
    rows.push({
      label: "İlk enstrüman",
      value: sound ? `${plan.name} · ${sound}` : plan.name,
    });
  }
  return rows;
}

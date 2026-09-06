/**
 * How closely the click counts, said in a guitarist's words (2V-D.2
 * completion §8).
 *
 * ## Two settings, not a number
 *
 * The engine's capability is a boolean — click every notated unit, or only
 * the main beats — and it has been there since c2 with nothing offering it.
 * What was missing is not the audio, it is the sentence: "subdivision" is a
 * word from the model, and a reader deciding how to count a 7/8 is choosing
 * between *hearing the three* and *hearing all seven*.
 *
 * So the two options are named for what they sound like, and the line under
 * them says what the quiet clicks are for. Neither ever mentions a pulse, a
 * strength or a resolution.
 *
 * ## Simple counts the beats
 *
 * The default is main beats, which is the count a beginner is trying to
 * feel. Every eighth is a rehearsal tool for a bar they already know is
 * uneven, so it lives behind **Daha fazla** with the rest of Pro.
 */
import { meterBeats, meterPulses } from "@/lib/music/meter-beats";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import type { Resolution, TimeSignature } from "@/lib/music/timing";

export type MetronomeDetail = "beats" | "units";

/** What the reader is choosing between. The default is first. */
export const METRONOME_DETAILS: readonly MetronomeDetail[] = ["beats", "units"];

export const DETAIL_LABEL: Readonly<Record<MetronomeDetail, string>> = {
  beats: "Yalnız ana vuruşlar",
  units: "Tüm sekizlikleri duy",
};

/**
 * How the finer setting is described for this metre, or null when there is
 * nothing extra to hear.
 *
 * In 4/4 the main beats *are* the notated units, so "hear all the eighths"
 * would promise a difference that does not exist; the row still offers both,
 * because a control that disappears when a bar changes is a control a reader
 * cannot rely on, but the sentence is only written when it is true.
 */
export function detailNote(input: {
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: BeatGrouping;
}): string | null {
  const beats = meterBeats(input).length;
  const units = meterPulses(input).length;
  if (units <= beats) return null;
  return `Grup başları daha güçlü, diğer ${unitName(input.meter)} daha hafif çalar.`;
}

/** What the metre's notated unit is called, in the plural a sentence needs. */
function unitName(meter: TimeSignature): string {
  return meter[1] === 8 ? "sekizlikler" : "dörtlükler";
}

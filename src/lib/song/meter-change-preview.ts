/**
 * What a meter change would do, before it does it (2V-D.2 §14).
 *
 * ## Why a preview, and not just an attempt
 *
 * `changeTiming` already refuses rather than truncating, so the *data* was
 * never at risk. What was at risk is the reader: they pick 5/8 on a full 4/4
 * bar, press apply, and get a sentence back. Nothing was lost, but nothing was
 * learned either — they still do not know whether their music fits, and the
 * only way to find out was to try.
 *
 * So the question is asked first. This runs the real command on a copy and
 * throws the result away, which means the preview and the apply cannot
 * disagree: there is no second model of what fits, and a rule added to the
 * command is a rule the preview gets for free. The cost is one transform per
 * preview, on one section.
 *
 * ## What it will never do
 *
 * Offer to make it fit. There is no "squeeze the last notes in", no automatic
 * speed-up, no quantise to the new bar. A bar that does not fit is reported as
 * not fitting, in a sentence a guitarist can act on, and the reader decides.
 * Silently stretching four beats of music into three is the single worst thing
 * an editor can do to a song, because the reader cannot see that it happened.
 */
import {
  barTicksOf,
  changeTiming,
  type TimingChange,
  type TimingChangeErrorCode,
} from "@/lib/song/timing-change";
import type { Song } from "@/lib/song/schema";

export type MeterChangePreview =
  | {
      readonly ok: true;
      /** How many bars the change would rewrite. */
      readonly barsChanged: number;
      /** True when the bar line moves, which is what a reader must be told. */
      readonly barLengthChanges: boolean;
      /** One sentence saying what will happen. Never jargon. */
      readonly summary: string;
    }
  | {
      readonly ok: false;
      readonly code: TimingChangeErrorCode;
      /** The one sentence Simple shows. Pro shows it too, plus its options. */
      readonly refusal: string;
      /** True when Pro has something to offer beyond "cancel". */
      readonly hasOverflow: boolean;
    };

/**
 * The refusals, in the reader's language.
 *
 * The command's own messages are precise and name a bar number, which is
 * right for a log and wrong for the first thing a beginner reads. These are
 * the sentences the sheet shows; the command's message is still available to
 * a caller that wants the detail.
 *
 * `content_exceeds_new_measure` is the one the brief names word for word,
 * because it is the one a reader will actually meet.
 */
const REFUSAL: Readonly<Record<TimingChangeErrorCode, string>> = {
  content_exceeds_new_measure: "Sondaki notalar yeni ölçüye sığmıyor.",
  target_grid_incompatible:
    "Bu notalar yeni ölçüde birebir yazılamıyor; hiçbiri yuvarlanmadı.",
  timing_change_splits_chain:
    "Ölçü çizgisini aşan bir bağlantı kopardı; ölçü değiştirilmedi.",
  unsupported_meter_resolution: "Bu ölçü bu grid ayrıntısında yazılamıyor.",
  grouping_does_not_fit: "Vurgu grupları bu ölçüyü tam doldurmuyor.",
  no_timing_change: "Bu ölçü zaten böyle yazılı.",
  section_not_found: "Bu bölüm artık şarkıda yok.",
  bar_not_found: "Bu ölçü artık bölümde yok.",
  validation_failed: "Bu değişiklik kontrollerden geçmedi ve uygulanmadı.",
};

/**
 * Ask the real command what would happen, and keep only the answer.
 *
 * The returned song is deliberately dropped. A preview that handed back a
 * song would be a second place an edit could be applied from, and the next
 * bug is a reader who previewed twice and committed the first answer.
 */
export function previewMeterChange(
  song: Song,
  change: TimingChange,
): MeterChangePreview {
  const result = changeTiming(song, change);
  if (!result.ok) {
    return {
      ok: false,
      code: result.error.code,
      refusal: REFUSAL[result.error.code],
      /* Only one refusal has anywhere else to go: the notes that do not fit
         could be pushed into the next bar. The rest are dead ends, and
         offering a choice there would be offering nothing. */
      hasOverflow: result.error.code === "content_exceeds_new_measure",
    };
  }

  const before = barTicksIn(song, change);
  const after = barTicksIn(result.song, change);
  const barLengthChanges = before !== after;
  return {
    ok: true,
    barsChanged: result.barsChanged,
    barLengthChanges,
    summary: barLengthChanges
      ? `${result.barsChanged} ölçü yeniden yazılacak; ölçü uzunluğu değişiyor.`
      : `${result.barsChanged} ölçü yeniden yazılacak; süreler aynı kalıyor.`,
  };
}

/** The first target bar's length in ticks, in whichever song is asked. */
function barTicksIn(song: Song, change: TimingChange): number | null {
  const section = song.sections.find((entry) => entry.id === change.sectionId);
  const index = change.scope.kind === "bar" ? change.scope.barIndex : 0;
  const bar = section?.bars[index];
  if (!bar) return null;
  return barTicksOf(bar.timeSignature, bar.resolution);
}

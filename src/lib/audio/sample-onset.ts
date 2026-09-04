/**
 * How long each recording takes to become audible (2V-C.4 §5, §7).
 *
 * ## Why a handoff needs this
 *
 * 2V-C.3 handed a shift slide over at the event level: the source stopped at
 * exactly the target's onset and the target started at exactly the same
 * sample. The founder still heard a small gap, and the rendered waveform
 * said why. A recording of a struck string does not reach its level at its
 * first sample — it rises — so for the first milliseconds after the onset
 * the source has been told to stop and the target is not loud yet. The hole
 * is between them.
 *
 * How long that takes is a property of the *recording*, and the recordings
 * differ enormously: measured on the decoded buffers, the guitar pack's E4
 * is at half its attack peak after 3 ms and its A3 takes 31 ms. A handoff
 * tuned for one of them is wrong for the other, which is why this is a table
 * and not a constant.
 *
 * ## Why the numbers are here rather than measured at load
 *
 * The plan is built before any audio context exists — the planner is pure
 * and runs in tests with no browser — so it cannot ask a decoded buffer
 * anything. The assets are vendored and immutable, so their attack times are
 * facts about files in this repository, and facts about files belong in
 * source.
 *
 * They are not, however, copied by hand and trusted: `profile-samples.mjs`
 * decodes the real packs in a browser and fails if what it measures no
 * longer matches this table. A pack that is re-vendored will therefore break
 * a run rather than quietly leave the handoff tuned for audio that is gone.
 *
 * ## What "attack" means here
 *
 * Time from the buffer's first sample to the first millisecond-frame that
 * reaches half the attack's peak. Half rather than nine tenths on purpose:
 * the guitar C4 reaches half in 6 ms and nine tenths only after 165 ms, and
 * a source asked to cover *that* would be playing over the target rather
 * than handing it the note.
 */
import { nearestSample, playbackRateFor, sampleEntries } from "@/lib/audio/sample-map";
import type { SamplePack } from "@/lib/audio/packs";

/** Seconds from a buffer's start to half its attack peak, by pack and note. */
export const SAMPLE_ATTACK_SECONDS: Readonly<
  Record<string, Readonly<Record<string, number>>>
> = {
  "electric_guitar/high_gain": {
    E2: 0.021,
    A2: 0.012,
    C3: 0.011,
    E3: 0.019,
    A3: 0.031,
    C4: 0.006,
    E4: 0.003,
  },
  "steel_acoustic/finger": {
    E2: 0.012,
    A2: 0.02,
    C3: 0.017,
    E3: 0.008,
    A3: 0.013,
    C4: 0.009,
    E4: 0.012,
    A4: 0.009,
  },
  "electric_bass/finger": {
    E1: 0.019,
    A1: 0.026,
    C2: 0.022,
    E2: 0.015,
    A2: 0.014,
    C3: 0.014,
  },
};

/**
 * What to assume when there is no measurement.
 *
 * The middle of the measured range rather than the fastest or the slowest.
 * A default at the fast end would leave a gap on an unmeasured pack and a
 * default at the slow end would smear one, and neither failure announces
 * itself.
 */
export const DEFAULT_ATTACK_SECONDS = 0.015;

/**
 * How long the note at this pitch takes to become audible, as it will be
 * heard.
 *
 * The pack chooses a recording and plays it at a rate; a buffer played 1.2×
 * faster has its attack 1.2× sooner, exactly as it has everything else
 * sooner. So the table's number is divided by the same rate the voice will
 * use — asked of the production `nearestSample` and `playbackRateFor`, so
 * this can never disagree with the sample the voice actually picks.
 */
export function attackSecondsFor(
  pack: SamplePack | undefined,
  targetMidi: number,
): number {
  if (!pack) return DEFAULT_ATTACK_SECONDS;
  const table = SAMPLE_ATTACK_SECONDS[pack.id];
  if (!table) return DEFAULT_ATTACK_SECONDS;
  const chosen = nearestSample(sampleEntries(Object.keys(pack.urls)), targetMidi);
  if (!chosen) return DEFAULT_ATTACK_SECONDS;
  const attack = table[chosen.note];
  if (attack === undefined) return DEFAULT_ATTACK_SECONDS;
  const rate = playbackRateFor(chosen.midi, targetMidi);
  return rate > 0 ? attack / rate : attack;
}

/**
 * Real rendered PCM for the seam analysis (2V-C.4 §3, §12).
 *
 * Evaluation only, and deliberately thin: every buffer here comes out of the
 * production `renderTake`, which is the same offline path the Listening Pack
 * uses, driving the production engine, scheduler, expression planner and
 * voice pool. There is no second synth and no hand-built waveform — the whole
 * point of the round is that the *shipped* audio is what has the seam in it.
 *
 * It runs in a browser because Web Audio does. The analysis itself is pure
 * and lives beside this file, so the same function measures a synthetic
 * control in a unit test and a real render here.
 */
import { editorFixture } from "@/lib/acceptance/editor-fixture";
import { acquireBank } from "@/lib/audio/buffer-bank";
import { samplePackFor } from "@/lib/audio/packs";
import { SAMPLE_ATTACK_SECONDS } from "@/lib/audio/sample-onset";
import { nearestSample, playbackRateFor, sampleEntries } from "@/lib/audio/sample-map";
import { renderTake } from "@/lib/listening/render-clip";
import { pitchToMidi } from "@/lib/music/pitch";
import { onsetShape, profileOnset } from "./sample-onset";
import { seamFixtures, type SeamFixtureName } from "./seam-fixtures";
import { SEAM_CLASS_LIMITS, measureSeam, seamVerdict } from "./seam-pcm";

declare global {
  interface Window {
    AranjeSeam: {
      fixtureNames(): SeamFixtureName[];
      measure(name: SeamFixtureName): Promise<unknown>;
      samples(): Promise<unknown>;
    };
  }
}

const fixtures = seamFixtures(editorFixture());

window.AranjeSeam = {
  fixtureNames: () => Object.keys(fixtures) as SeamFixtureName[],
  async measure(name) {
    const fixture = fixtures[name];
    if (!fixture) return { name, error: "no such fixture" };
    const rendered = await renderTake(fixture.song, fixture.take, {
      ...(fixture.practicePercent === undefined
        ? {}
        : { practicePercent: fixture.practicePercent }),
    });
    /*
     * The seam is where the target's onset lands inside the rendered clip.
     * Taken from the fixture rather than searched for in the audio: a seam
     * located by looking for a dip would find one wherever it looked.
     */
    const seam = measureSeam(rendered.channels, rendered.sampleRate, fixture.seamSeconds);
    return {
      name,
      what: fixture.what,
      seamSeconds: fixture.seamSeconds,
      practicePercent: fixture.practicePercent ?? 100,
      seamClass: fixture.seamClass,
      expectContinuous: fixture.expectContinuous,
      audit: rendered.audit,
      activeAfterDispose: rendered.activeAfterDispose,
      /*
       * The envelope goes in the artifact too. A single ratio says a seam got
       * better; only the frames say *how* — whether the dip moved, filled or
       * merely shifted — and the before/after comparison the round owes is
       * read off these.
       */
      envelope: {
        firstFrameSeconds: seam.firstFrameSeconds,
        frameSeconds: seam.frameSeconds,
        rms: seam.rms.map((value) => Math.round(value * 1e6) / 1e6),
        peak: seam.peak.map((value) => Math.round(value * 1e6) / 1e6),
      },
      seam: {
        beforeMedianRms: seam.beforeMedianRms,
        afterMedianRms: seam.afterMedianRms,
        minRms: seam.minRms,
        minRmsSeconds: seam.minRmsSeconds,
        valleyRatio: seam.valleyRatio,
        sourceLastEnergySeconds: seam.sourceLastEnergySeconds,
        targetFirstEnergySeconds: seam.targetFirstEnergySeconds,
        silentSeconds: seam.silentSeconds,
        silentFrames: seam.silentFrames,
        maxStep: seam.maxStep,
        maxStepSeconds: seam.maxStepSeconds,
        targetPeak: seam.targetPeak,
        targetPeakSeconds: seam.targetPeakSeconds,
        clipped: seam.clipped,
        invalid: seam.invalid,
      },
      verdict: seamVerdict(seam, SEAM_CLASS_LIMITS[fixture.seamClass]),
    };
  },

  /*
   * The recordings themselves, decoded by the production loader (§5).
   *
   * The pitches asked about are the ones the seam fixtures actually land on
   * — low, middle and high register — and each is reported with the sample
   * the production `nearestSample` picks for it and the rate it is played
   * at, because a buffer's head is stretched by that rate exactly as the
   * rest of it is. A profile of the file alone would be a fact about the
   * pack; this is a fact about the note that gets played.
   */
  async samples() {
    const tone = await import("tone");
    const context = new tone.Context({ latencyHint: "playback" });
    const wanted: readonly (readonly [string, string])[] = [
      ["electric_guitar", "high_gain"],
      ["steel_acoustic", "finger"],
      ["electric_bass", "finger"],
    ];

    const packs = [];
    for (const [instrument, preset] of wanted) {
      const pack = samplePackFor(instrument, preset);
      if (!pack) continue;
      const bank = acquireBank(tone, context, pack, () => {});
      await bank.loaded;
      const entries = sampleEntries(Object.keys(pack.urls));

      /*
       * The production table is checked against what actually decoded (§5).
       *
       * `SAMPLE_ATTACK_SECONDS` is the number the shipped handoff derives its
       * tail from, and it lives in source because the planner is pure and has
       * no buffers to ask. That is only safe while it still describes these
       * files: a re-vendored pack would otherwise leave the handoff tuned for
       * audio that is gone, silently. So every row is compared here, against
       * the real decode, and a mismatch fails the run.
       */
      const table = SAMPLE_ATTACK_SECONDS[pack.id] ?? {};
      const files = Object.keys(pack.urls).map((note) => {
        const buffer = bank.buffers.get(note);
        const profile = profileOnset(buffer.getChannelData(0), buffer.sampleRate);
        const claimed = table[note];
        const measured = profile.reach50Seconds;
        return {
          note,
          profile,
          shape: onsetShape(profile),
          claimedAttackSeconds: claimed ?? null,
          attackMatches:
            claimed !== undefined &&
            measured !== null &&
            Math.abs(claimed - measured) <= 0.0015,
        };
      });

      /* Every pitch the fixtures land on, low to high, plus the open strings
         either end — a table with a hole in it is a policy with a default in
         it, and the default is what would then be doing the work. */
      const notes = ["E2", "A2", "D3", "G3", "B3", "C4", "D4", "E4", "G4", "A4"];
      const played = notes.map((name) => {
        const midi = pitchToMidi(name);
        const chosen = midi === null ? null : nearestSample(entries, midi);
        if (midi === null || !chosen) return { note: name, error: "no sample" };
        const rate = playbackRateFor(chosen.midi, midi);
        const buffer = bank.buffers.get(chosen.note);
        const profile = profileOnset(buffer.getChannelData(0), buffer.sampleRate);
        const scale = (value: number | null) =>
          value === null ? null : Math.round((value / rate) * 1e6) / 1e6;
        return {
          note: name,
          sample: chosen.note,
          playbackRate: Math.round(rate * 1e6) / 1e6,
          shape: onsetShape(profile),
          /* Divided by the rate: played faster, the head arrives sooner. */
          heardSilenceSeconds: scale(profile.digitalSilenceSeconds),
          heardFirstEnergySeconds: scale(profile.firstEnergySeconds),
          heardReach10Seconds: scale(profile.reach10Seconds),
          heardReach50Seconds: scale(profile.reach50Seconds),
          heardReach90Seconds: scale(profile.reach90Seconds),
        };
      });

      bank.release();
      packs.push({ pack: pack.id, files, played });
    }

    return { packs };
  },
};

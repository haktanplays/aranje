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
import { renderTake } from "@/lib/listening/render-clip";
import { seamFixtures, type SeamFixtureName } from "./seam-fixtures";
import { SEAM_CLASS_LIMITS, measureSeam, seamVerdict } from "./seam-pcm";

declare global {
  interface Window {
    AranjeSeam: {
      fixtureNames(): SeamFixtureName[];
      measure(name: SeamFixtureName): Promise<unknown>;
    };
  }
}

const fixtures = seamFixtures(editorFixture());

window.AranjeSeam = {
  fixtureNames: () => Object.keys(fixtures) as SeamFixtureName[],
  async measure(name) {
    const fixture = fixtures[name];
    if (!fixture) return { name, error: "no such fixture" };
    const rendered = await renderTake(fixture.song, fixture.take);
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
};

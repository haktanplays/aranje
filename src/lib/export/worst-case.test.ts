/**
 * The real worst case, derived from the product's own limits (2M-A.1 §1, §3).
 *
 * The first report of this checkpoint quoted a worst-case WAV of ≈9.9 MiB.
 * That was the *event-heavy* song's size: the fixture it came from ran at 138
 * BPM, and nothing in it went anywhere near the slowest tempo the contract
 * permits. The longest song the product can actually produce is more than
 * three times that, and these tests exist so the number can never again be a
 * fixture's accident.
 *
 * Every assertion reads the limits rather than restating them, and each one
 * is written so that using a convenient tempo, a shorter song, a missing tail
 * or a dropped channel makes it fail.
 */
import { describe, expect, it } from "vitest";

import { buildNotatedPlan } from "@/lib/audio/schedule";
import { buildTempoMap } from "@/lib/audio/tempo";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { audioExportLimits, bpmRange, songLimits } from "@/lib/limits";
import { TICKS_PER_WHOLE, TIME_SIGNATURES, ticksPerBar } from "@/lib/music/timing";
import { runValidators } from "@/lib/validators";
import {
  derivedLongestDuration,
  heaviestEventSong,
  longestDurationSong,
  longestMeter,
} from "../../../eval/shared/export-worst-case";
import { estimateWav, renderDuration } from "@/lib/export/export-plan";
import { encodeWav, wavByteLength } from "@/lib/export/wav-encoder";

const barsOf = (song: Parameters<typeof buildNotatedPlan>[0]) =>
  buildNotatedPlan(song).bars.length;

describe("78. the longest song the limits allow", () => {
  it("picks the slowest tempo the contract permits, not a comfortable one", () => {
    /*
     * The exact mistake that produced the wrong figure: a fixture at 138 BPM
     * called "worst case". A tempo above the minimum makes every downstream
     * number — seconds, frames, bytes, memory — smaller than the truth.
     */
    const song = longestDurationSong();
    expect(song.bpm).toBe(bpmRange.min);
    for (const section of song.sections) {
      expect(section.bpmOverride ?? bpmRange.min).toBe(bpmRange.min);
    }
    // And the tempo map really runs at it.
    for (const segment of buildTempoMap(song).segments) {
      expect(segment.writtenBpm).toBe(bpmRange.min);
    }
  });

  it("uses every bar the contract allows", () => {
    expect(barsOf(longestDurationSong())).toBe(songLimits.totalBars);
  });

  it("uses the meter whose bar actually lasts longest", () => {
    // Measured against every meter in the table, not assumed to be 4/4.
    const { meter, ticks } = longestMeter();
    for (const entry of TIME_SIGNATURES) {
      const candidate = entry;
      // Every meter in the table is writable at 1/8, and a bar's length in
      // ticks does not depend on the grid it is written at.
      expect(ticksPerBar(candidate, 8), `${entry[0]}/${entry[1]}`).toBeLessThanOrEqual(
        ticks,
      );
    }
    expect(longestDurationSong().sections[0]?.bars[0]?.timeSignature).toEqual(meter);
  });

  it("keeps an audible note in the very last bar", () => {
    // Otherwise the tail would be measured on silence, which proves nothing.
    const plan = buildNotatedPlan(longestDurationSong());
    const lastBar = plan.bars[plan.bars.length - 1]!;
    expect(plan.events.length).toBeGreaterThan(0);
    const last = plan.events[plan.events.length - 1]!;
    expect(last.time).toBeGreaterThanOrEqual(lastBar.time);
  });

  it("is playable: the validators find nothing to refuse", () => {
    const issues = runValidators(longestDurationSong());
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("lasts what the arithmetic says it lasts", () => {
    /*
     * The derivation, spelled out: a bar is its tick count times
     * `60 / (bpm × PPQ)`, and the song is that times the bar limit. The
     * render duration is checked against it independently, so the fixture and
     * the product have to agree.
     */
    const derived = derivedLongestDuration();
    const ticksPerQuarter = TICKS_PER_WHOLE / 4;
    const expectedSecondsPerBar =
      derived.ticksPerBar * (60 / (bpmRange.min * ticksPerQuarter));

    expect(derived.secondsPerBar).toBeCloseTo(expectedSecondsPerBar, 9);
    expect(derived.notatedSeconds).toBeCloseTo(
      songLimits.totalBars * expectedSecondsPerBar,
      9,
    );

    const duration = renderDuration(longestDurationSong());
    expect(duration.notatedSeconds).toBeCloseTo(derived.notatedSeconds, 6);
    expect(duration.tailSeconds).toBe(audioExportLimits.tailSeconds);
    expect(duration.totalSeconds).toBeCloseTo(
      derived.notatedSeconds + duration.expressionSeconds + audioExportLimits.tailSeconds,
      6,
    );
  });

  it("includes the tail in the frame count, not just in the report", () => {
    // A tail that is reported but not rendered is a tail that does not exist.
    const song = longestDurationSong();
    const duration = renderDuration(song);
    const estimate = estimateWav(song);

    const withoutTail = Math.ceil(
      duration.notatedSeconds * audioExportLimits.sampleRate,
    );
    expect(estimate.frames).toBeGreaterThan(withoutTail);
    expect(estimate.frames - withoutTail).toBeGreaterThanOrEqual(
      audioExportLimits.tailSeconds * audioExportLimits.sampleRate - 1,
    );
  });
});

describe("79. the size that follows from it", () => {
  it("is the formula, to the byte", () => {
    const estimate = estimateWav(longestDurationSong());
    const bytesPerSample = audioExportLimits.bitDepth / 8;

    // 44 + frames × channels × bytesPerSample — written out rather than
    // borrowed, so a change to either side has to be deliberate.
    expect(estimate.bytes).toBe(
      44 + estimate.frames * audioExportLimits.channels * bytesPerSample,
    );
    expect(estimate.bytes).toBe(
      wavByteLength(estimate.frames, audioExportLimits.channels),
    );
    expect(estimate.channels).toBe(audioExportLimits.channels);
    expect(estimate.sampleRate).toBe(audioExportLimits.sampleRate);
  });

  it("counts both channels and the full bit depth", () => {
    /*
     * Dropping a channel or halving the depth would quietly halve the
     * estimate, which is exactly the kind of wrong number that reads as
     * plausible. Both terms are pinned by comparing against a deliberately
     * wrong version of the same arithmetic.
     */
    const estimate = estimateWav(longestDurationSong());
    const mono = 44 + estimate.frames * 1 * (audioExportLimits.bitDepth / 8);
    const eightBit = 44 + estimate.frames * audioExportLimits.channels * 1;

    expect(estimate.bytes).not.toBe(mono);
    expect(estimate.bytes).not.toBe(eightBit);
    // Exactly double the mono figure, minus the header counted once.
    expect(estimate.bytes - 44).toBe((mono - 44) * audioExportLimits.channels);
    // A whole number of stereo 16-bit frames, with nothing left over.
    expect((estimate.bytes - 44) % (audioExportLimits.channels * 2)).toBe(0);
  });

  it("is what the encoder really produces for that many frames", () => {
    /*
     * The estimate and the file, compared for real. Encoding 8.6 million
     * frames of silence is the honest way to check the promise, because it is
     * the same code path a rendered song takes.
     */
    const estimate = estimateWav(longestDurationSong());
    const silence = new Float32Array(estimate.frames);
    const encoded = encodeWav({
      channels: [silence, silence],
      sampleRate: audioExportLimits.sampleRate,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(encoded.bytes.length).toBe(estimate.bytes);

    // ...and the header inside those bytes agrees with the file's own length.
    const view = new DataView(
      encoded.bytes.buffer,
      encoded.bytes.byteOffset,
      encoded.bytes.byteLength,
    );
    expect(view.getUint32(40, true)).toBe(encoded.bytes.length - 44);
    expect(view.getUint32(4, true)).toBe(encoded.bytes.length - 8);
    expect(view.getUint16(22, true)).toBe(audioExportLimits.channels);
    expect(view.getUint16(34, true)).toBe(audioExportLimits.bitDepth);
  });

  it("is far larger than a song at a comfortable tempo", () => {
    /*
     * The regression this whole file exists for. At 138 BPM — the tempo the
     * old fixture used — the same 32 bars produce a fraction of the bytes, so
     * a "worst case" measured there understates the real one several times
     * over. Stated as a ratio, not a magic number.
     */
    const slowest = estimateWav(longestDurationSong());
    const busy = estimateWav(heaviestEventSong());
    expect(slowest.bytes).toBeGreaterThan(busy.bytes * 2);
  });
});

describe("80. the heaviest event load is a different song", () => {
  it("uses every track and every bar", () => {
    const song = heaviestEventSong();
    expect(song.tracks.length).toBe(songLimits.maxTracks);
    expect(barsOf(song)).toBe(songLimits.totalBars);
  });

  it("writes on the finest grid the meter allows", () => {
    const song = heaviestEventSong();
    const bar = song.sections[0]?.bars[0];
    expect(bar).toBeDefined();
    if (!bar) return;
    expect(bar.resolution).toBe(32);
    expect(ticksPerBar(bar.timeSignature, bar.resolution)).toBe(TICKS_PER_WHOLE);
  });

  it("carries real onsets on melodic and drum tracks alike", () => {
    const plan = buildNotatedPlan(heaviestEventSong());
    const notes = plan.events.filter((event) => event.kind === "note");
    const drums = plan.events.filter((event) => event.kind === "drum");
    expect(notes.length).toBeGreaterThan(1000);
    expect(drums.length).toBeGreaterThan(500);
  });

  it("really exercises the expression planner, with nothing falling back", () => {
    /*
     * Legato that the planner refuses is not legato: it is the fallback path
     * being measured under another name. Every chain here is one the planner
     * actually built.
     */
    const plan = buildExpressionPlan(heaviestEventSong());
    expect(plan.expressiveNotes).toBeGreaterThan(0);
    expect(plan.chains.length).toBeGreaterThan(0);
    expect(plan.fallbacks).toBe(0);
  });

  it("is playable: the validators find nothing to refuse", () => {
    const issues = runValidators(heaviestEventSong());
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("is not the duration fixture wearing a different hat", () => {
    // Two pressures, two songs. Collapsing them hides whichever one the
    // surviving fixture happens not to apply.
    const longest = longestDurationSong();
    const heaviest = heaviestEventSong();
    expect(heaviest.tracks.length).toBeGreaterThan(longest.tracks.length);
    expect(buildNotatedPlan(heaviest).events.length).toBeGreaterThan(
      buildNotatedPlan(longest).events.length * 100,
    );
    expect(renderDuration(longest).totalSeconds).toBeGreaterThan(
      renderDuration(heaviest).totalSeconds,
    );
  });
});

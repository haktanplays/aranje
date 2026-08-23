/**
 * What the mixer costs, measured rather than asserted (spec 13.18 §17).
 *
 * Every number in the `node` section is a desktop **Node** measurement and is
 * labelled as one: it says how the pure model and the controller behave on
 * this machine, and nothing at all about a phone. The browser half
 * (`measure-browser.mjs`) adds the real `localStorage.setItem` of a mix
 * commit's envelope and merges into the same report; the audio half
 * (`measure-audio.mjs`, `AUDIO.json`) is the rendered-sound table.
 *
 * The engine here is the injected fake the runtime tests use — the point is
 * the *counting*: how many engines a mix change builds, how many schedules
 * and cancels it causes, how many samples it decodes. Those are the numbers
 * §17 asks for, and they are exact rather than timed.
 *
 *   NODE_OPTIONS=--expose-gc npx tsx eval/mixer/measure.ts
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { sizes, worstCasePlayableSong } from "../shared/worst-case-song";

import { PlaybackController } from "@/lib/audio/playback";
import { buildSongPlan } from "@/lib/audio/schedule";
import { mixerLimits } from "@/lib/limits";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";
import {
  EMPTY_AUDITION,
  applyMixCommand,
  audibleTrackIds,
  readTrackMixes,
  setTrackMuted,
  setTrackSoloed,
  type TrackAudition,
  type TrackMixMap,
} from "@/lib/song/track-mix";
import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";

const ROUNDS = 25;
const WARMUP = 5;

type Stats = { rounds: number; medianMs: number; p95Ms: number; maxMs: number };

function bench(run: () => unknown): Stats {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples: number[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)] ?? 0;
  const round = (value: number) => Number(value.toFixed(3));
  return {
    rounds: ROUNDS,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(samples[samples.length - 1] ?? 0),
  };
}

/* --------------------------------------------------------------- subjects */

/** The heaviest song the contract allows: 8 tracks, 32 bars. */
const worst = songSchema.parse(worstCasePlayableSong());
const trackIds = worst.tracks.map((track) => track.id);

/** A staged draft that moved every one of the eight tracks. */
const opened = readTrackMixes(worst);
const stagedAll: TrackMixMap = Object.fromEntries(
  trackIds.map((id, index) => [
    id,
    {
      volumeDb: mixerLimits.volumeDb.min + index,
      pan: Number((index * 0.25 - 0.75).toFixed(2)),
    },
  ]),
);

/** One slider move, the thing that happens dozens of times per session. */
const stageOnce = (draft: TrackMixMap, step: number): TrackMixMap => {
  const id = trackIds[step % trackIds.length]!;
  const existing = draft[id]!;
  return {
    ...draft,
    [id]: { ...existing, volumeDb: -6 - (step % 12) * 0.5 },
  };
};

/** Half muted, one soloed: the audition shape that exercises every rule. */
let audition: TrackAudition = EMPTY_AUDITION;
for (const id of trackIds.slice(0, 4)) audition = setTrackMuted(audition, id, true);
audition = setTrackSoloed(audition, trackIds[5]!, true);

const applied = applyMixCommand(worst, {
  kind: "update_track_mix",
  mixes: stagedAll,
});
if (!applied.ok) throw new Error("mix refused — measurement invalid");
const committed = applied.song;

/* ------------------------------------------------------- the timed numbers */

let step = 0;
const stagedMixUpdate = bench(() => {
  step += 1;
  return stageOnce(opened, step);
});

const audibilityComputation = bench(() => audibleTrackIds(worst, audition));

const mixerApply = bench(() =>
  applyMixCommand(worst, { kind: "update_track_mix", mixes: stagedAll }),
);

const mixerReset = bench(() =>
  applyMixCommand(committed, {
    kind: "reset_track_mix_to_opened_value",
    opened,
  }),
);

const validatorPipeline = bench(() => runValidators(worst));

/* ------------------------------------------ the counted (not timed) numbers */

type FakeChannel = { volume: { value: number }; pan: { value: number }; mute: boolean };

/**
 * The same injected engine the runtime tests drive.
 *
 * Nothing is being timed here: what is reported is how many engines were
 * built, how many transport schedules and cancels happened, and how many
 * sample banks were decoded while a mix moved. Those counts are the §7
 * promise, and a count is either right or wrong.
 */
function countingBench(song: Song) {
  const channels = new Map<string, FakeChannel>();
  const voices = new Map<string, { trackId: string; channel: FakeChannel }>();
  let builds = 0;
  let decodes = 0;
  const transport = {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: { value: 0, setValueAtTime() {}, cancelScheduledValues() {} },
    loop: false,
    loopStart: "0i",
    loopEnd: "0i",
    scheduled: 0,
    cancels: 0,
    schedule() {
      this.scheduled += 1;
      return this.scheduled;
    },
    on() {},
    start() {},
    pause() {},
    stop() {},
    cancel() {
      this.cancels += 1;
    },
  };

  const controller = new PlaybackController(song, {
    createEngine: async (forSong: Song) => {
      builds += 1;
      channels.clear();
      voices.clear();
      for (const track of forSong.tracks) {
        decodes += 1;
        const channel: FakeChannel = {
          volume: { value: track.volumeDb },
          pan: { value: track.pan ?? 0 },
          mute: false,
        };
        channels.set(track.id, channel);
        voices.set(track.id, { trackId: track.id, channel });
      }
      return {
        context: { transport, dispose() {} },
        master: {},
        metronome: {},
        voices,
        meters: {},
        plan: buildSongPlan(forSong),
        expression: { stopAll() {}, counts: { active: 0 }, fetchedUrls: 0 },
        expectedBuffers: forSong.tracks.length,
        loadedBuffers: forSong.tracks.length,
        dispose() {},
      } as never;
    },
  });

  return { controller, transport, channels, builds: () => builds, decodes: () => decodes };
}

async function countMixWork() {
  const bench = countingBench(worst);
  await bench.controller.play();

  const before = {
    builds: bench.builds(),
    decodes: bench.decodes(),
    scheduled: bench.transport.scheduled,
    cancels: bench.transport.cancels,
  };

  // Twenty-five runtime level writes, then one audibility pass, then the
  // commit the "Uygula" button makes.
  const start = performance.now();
  for (let index = 0; index < ROUNDS; index += 1) {
    const id = trackIds[index % trackIds.length]!;
    bench.controller.setTrackMix(id, -6 - (index % 12) * 0.5, (index % 5) * 0.25 - 0.5);
  }
  const runtimeWriteMs = performance.now() - start;

  const audibilityStart = performance.now();
  bench.controller.setTrackAudibility(audibleTrackIds(worst, audition));
  const audibilityWriteMs = performance.now() - audibilityStart;

  const commitStart = performance.now();
  bench.controller.applyMixOnly(committed);
  const commitMs = performance.now() - commitStart;

  return {
    runtimeGainPanWrite: {
      writes: ROUNDS,
      totalMs: Number(runtimeWriteMs.toFixed(3)),
      perWriteMs: Number((runtimeWriteMs / ROUNDS).toFixed(4)),
    },
    runtimeAudibilityWrite: {
      tracks: worst.tracks.length,
      ms: Number(audibilityWriteMs.toFixed(4)),
    },
    runtimeMixCommit: { ms: Number(commitMs.toFixed(4)) },
    constancy: {
      engineBuilds: { before: before.builds, after: bench.builds() },
      sampleDecodes: { before: before.decodes, after: bench.decodes() },
      transportSchedules: {
        before: before.scheduled,
        after: bench.transport.scheduled,
      },
      transportCancels: { before: before.cancels, after: bench.transport.cancels },
      note: "Ses/stereo/audibility/mix commit sırasında motor, schedule ve decode sayıları değişmemelidir.",
    },
  };
}

/* ------------------------- payload for the browser's setItem measurement */

const before = nextEnvelope(worst, decideLoad(null));
const commitEnvelope = JSON.stringify(
  nextEnvelope(committed, decideLoad(JSON.stringify(before))),
);
writeFileSync(
  join(tmpdir(), "aranje-2lc-mix-envelope.json"),
  commitEnvelope,
  "utf8",
);

/* ------------------------------------------------------------------ report */

async function main() {
const counted = await countMixWork();

const report = {
  method: {
    rounds: ROUNDS,
    warmupRounds: WARMUP,
    statistic: "median / p95 / max over timed rounds after warm-up",
  },
  honesty: [
    "Bu bölümdeki sayılar masaüstü Node ölçümüdür; fiziksel telefon kanıtı değildir.",
    "Chromium bölümü masaüstü tarayıcı ölçümüdür ve ayrı tutulmuştur.",
    "Motor/schedule/decode sayıları ölçüm değil sayımdır: doğru ya da yanlıştır.",
    "Bu ölçümler müzikal mix kabulü değildir; ses tablosu AUDIO.json içindedir.",
  ],
  node: {
    version: process.version,
    subject: {
      ...sizes(worst),
      tracks: worst.tracks.length,
      stagedTracks: Object.keys(stagedAll).length,
      audition: {
        muted: [...audition.muted].length,
        soloed: [...audition.soloed].length,
      },
    },
    stagedMixUpdate,
    audibilityComputation,
    mixerApply,
    mixerReset,
    validatorPipeline,
    ...counted,
  },
  chromium: null as unknown,
};

writeFileSync("eval/mixer/PERFORMANCE.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.node, null, 2));
}

void main();

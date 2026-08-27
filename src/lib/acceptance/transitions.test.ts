import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERCENT,
  emptyTransportLog,
  foldTransport,
  observeTransport,
  type TransportSample,
} from "@/lib/acceptance/transitions";

const at = (over: Partial<TransportSample> = {}): TransportSample => ({
  status: "idle",
  ticks: 0,
  barIndex: 0,
  loopOn: false,
  percent: DEFAULT_PERCENT,
  offersPlay: true,
  ...over,
});

const playing = (over: Partial<TransportSample> = {}) =>
  at({ status: "playing", offersPlay: false, ...over });

describe("observeTransport", () => {
  it("starts with nothing claimed", () => {
    const log = emptyTransportLog();
    expect(log.order).toEqual([]);
    expect(log.played).toBe(false);
    expect(log.seekedBarIndex).toBeNull();
    expect(log.tempoPercent).toBeNull();
  });

  it("records the reader's sequence in the order it happened", () => {
    const log = foldTransport([
      at(),
      playing({ ticks: 40 }),
      at({ status: "paused", ticks: 90 }),
      playing({ ticks: 95 }),
      at({ status: "paused", ticks: 120 }),
      at({ status: "paused", ticks: 256, barIndex: 1 }),
      at({ status: "paused", ticks: 256, barIndex: 1, loopOn: true }),
      at({ status: "paused", ticks: 256, barIndex: 1, loopOn: true, percent: 70 }),
      at({ status: "paused", ticks: 0, barIndex: 0, loopOn: true, percent: 70 }),
    ]);
    expect(log.order).toEqual([
      "play",
      "pause",
      "resume",
      "seek",
      "loop",
      "tempo",
      "rewind",
    ]);
    expect(log.seekedBarIndex).toBe(1);
    expect(log.tempoPercent).toBe(70);
    expect(log.rewound).toBe(true);
  });

  /*
   * The failure the old boolean version produced on a real device: the reader
   * used every control, the poll happened to sample between the transitions,
   * and the result block called all of it a problem.
   */
  it("keeps a transition the poll only caught once", () => {
    const log = foldTransport([at(), playing({ ticks: 12 }), at({ status: "paused", ticks: 30 })]);
    expect(log.played).toBe(true);
    expect(log.paused).toBe(true);
  });

  it("is idempotent: the same sample twice adds nothing", () => {
    const sample = playing({ ticks: 10 });
    const once = observeTransport(emptyTransportLog(), sample, null);
    const twice = observeTransport(once, sample, sample);
    expect(twice.order).toEqual(once.order);
  });

  /*
   * A song that ran to its end must have played, and the reader letting it do
   * that is not the reader pressing pause — so `played` latches and `paused`
   * does not. Conflating the two would let a run that never touched the pause
   * control report a clean pause.
   */
  it("counts a finished passage as having played, but not as a pause", () => {
    const log = foldTransport([at(), at({ status: "ended", ticks: 512 })]);
    expect(log.played).toBe(true);
    expect(log.paused).toBe(false);
    expect(log.order).toEqual(["play"]);
  });

  it("does not invent a play from a transport that only ever sat still", () => {
    const log = foldTransport([at(), at(), at({ status: "loading" }), at()]);
    expect(log.played).toBe(false);
    expect(log.paused).toBe(false);
    expect(log.order).toEqual([]);
  });

  it("does not call the opening bar a seek", () => {
    const log = foldTransport([at({ barIndex: 0 }), at({ barIndex: 0 })]);
    expect(log.seekedBarIndex).toBeNull();
  });

  it("does not call the playhead crossing a bar a seek", () => {
    const log = foldTransport([
      playing({ barIndex: 0, ticks: 10 }),
      playing({ barIndex: 1, ticks: 260 }),
      playing({ barIndex: 2, ticks: 520 }),
    ]);
    expect(log.seekedBarIndex).toBeNull();
    expect(log.order).toEqual(["play"]);
  });

  it("reads the speed from the settings the app holds, not from a default", () => {
    expect(foldTransport([at({ percent: DEFAULT_PERCENT })]).tempoPercent).toBeNull();
    expect(foldTransport([at({ percent: 85 })]).tempoPercent).toBe(85);
  });

  it("does not call a rewind a rewind when nothing ever moved", () => {
    const log = foldTransport([at({ ticks: 0 }), at({ ticks: 0 })]);
    expect(log.rewound).toBe(false);
  });

  it("flags the engine playing while the button still offers to play", () => {
    const stuck = playing({ offersPlay: true });
    const log = foldTransport([stuck, stuck, stuck]);
    expect(log.desync).toBe(true);
  });

  it("does not flag a single tick of disagreement as a desync", () => {
    const log = foldTransport([playing({ offersPlay: true }), playing()]);
    expect(log.desync).toBe(false);
  });

  it("can be started again from empty for a second run", () => {
    const used = foldTransport([playing({ ticks: 10 })]);
    expect(used.played).toBe(true);
    expect(emptyTransportLog().played).toBe(false);
  });
});

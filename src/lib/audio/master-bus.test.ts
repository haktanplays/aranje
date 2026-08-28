import { describe, expect, it } from "vitest";

import {
  MASTER_CEILING_DB,
  MASTER_HEADROOM_DB,
  afterHeadroomDbfs,
  dbToGain,
  gainToDb,
  masterGain,
  needsCeiling,
} from "@/lib/audio/master-bus";

/**
 * The peaks measured through the production chain in 2O-B.1, before anything
 * in this phase was changed. Every expectation below is stated against these
 * rather than against a number chosen to make the test pass.
 */
const MEASURED = {
  templateMix: -0.85,
  denseSixAtZero: 5.15,
  twoGuitars: 4.17,
  hardPanned: 2.16,
  powerTwo: -9.95,
} as const;

describe("the master bus", () => {
  it("converts between dB and gain without drifting", () => {
    expect(dbToGain(0)).toBe(1);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(dbToGain(-6))).toBeCloseTo(-6, 10);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 4);
  });

  it("runs the master below unity, which it never did before", () => {
    expect(MASTER_HEADROOM_DB).toBeLessThan(0);
    expect(masterGain()).toBeLessThan(1);
    expect(gainToDb(masterGain())).toBeCloseTo(MASTER_HEADROOM_DB, 10);
  });

  /*
   * The template mix is the ordinary case, and the point of the trim is that
   * it is left alone by the ceiling. A limiter that works on ordinary
   * material is a compressor nobody asked for.
   */
  it("gives the ordinary mix real headroom and no ceiling work", () => {
    expect(afterHeadroomDbfs(MEASURED.templateMix)).toBeCloseTo(-3.85, 6);
    expect(needsCeiling(MEASURED.templateMix)).toBe(false);
    expect(needsCeiling(MEASURED.powerTwo)).toBe(false);
  });

  /*
   * And the cases that actually clipped are the ones the ceiling is for. The
   * trim alone does not rescue them, which is the reason there are two
   * stages rather than one bigger trim.
   */
  it.each([
    ["a six-note chord at unity", MEASURED.denseSixAtZero],
    ["two guitars", MEASURED.twoGuitars],
    ["a hard-panned chord", MEASURED.hardPanned],
  ])("still needs the ceiling for %s", (_name, peak) => {
    expect(afterHeadroomDbfs(peak)).toBeGreaterThan(MASTER_CEILING_DB);
    expect(needsCeiling(peak)).toBe(true);
  });

  it("keeps the ceiling below zero, for the peak between two samples", () => {
    expect(MASTER_CEILING_DB).toBeLessThan(0);
  });

  it("would not have rescued anything before the trim existed", () => {
    /* Unity master: every measured clip was over full scale as rendered. */
    expect(MEASURED.denseSixAtZero).toBeGreaterThan(0);
    expect(MEASURED.twoGuitars).toBeGreaterThan(0);
  });
});

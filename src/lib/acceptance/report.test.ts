import { describe, expect, it } from "vitest";

import {
  LISTEN_KEYS,
  formatResult,
  overallVerdict,
  type AcceptanceAnswers,
  type AcceptanceAuto,
  type AcceptanceDevice,
  type ListenKey,
} from "@/lib/acceptance/report";

const everyKey = <T,>(value: T): Readonly<Record<ListenKey, T>> =>
  Object.fromEntries(LISTEN_KEYS.map((key) => [key, value])) as Record<ListenKey, T>;

const CLEAN_AUTO: AcceptanceAuto = {
  selectionOpened: true,
  moreSheetOpened: true,
  selectionCancelled: true,
  ghostVoices: 3,
  ghostWroteNothing: true,
  played: true,
  paused: true,
  resumed: true,
  seekedBarIndex: 1,
  loopSeen: true,
  tempoChanged: true,
  transportDesync: false,
  stuckLoading: false,
  errors: [],
  heard: everyKey(true),
  storageUnchanged: true,
};

const CLEAN_ANSWERS: AcceptanceAnswers = {
  visual: "ok",
  ghost: "ok",
  listen: everyKey("clear"),
  note: "",
};

const DEVICE: AcceptanceDevice = {
  date: "2026-08-27T09:00:00.000Z",
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/126.0.0.0 Mobile",
  platform: "Linux armv8l",
  viewport: "412×915",
  pixelRatio: 2.625,
  touchPoints: 5,
  reducedMotion: false,
  online: true,
  audioState: "running",
  loadMs: 1840,
  firstSoundMs: 2100,
  buffers: "21/21",
};

describe("overallVerdict", () => {
  it("passes only when everything measured held and every answer was given", () => {
    expect(overallVerdict(CLEAN_ANSWERS, CLEAN_AUTO)).toBe("PASS");
  });

  it.each([
    ["an uncaught error", { errors: ["TypeError: boom"] }],
    ["a mutated localStorage", { storageUnchanged: false }],
    ["a transport the button disagrees with", { transportDesync: true }],
    ["sounds that never finished loading", { stuckLoading: true }],
  ])("fails on %s, whatever the reader answered", (_name, broken) => {
    expect(overallVerdict(CLEAN_ANSWERS, { ...CLEAN_AUTO, ...broken })).toBe("FAIL");
  });

  it("fails when a technique came back silent or wrong", () => {
    for (const value of ["silent", "wrong"] as const) {
      const answers = {
        ...CLEAN_ANSWERS,
        listen: { ...CLEAN_ANSWERS.listen, vibrato: value },
      };
      expect(overallVerdict(answers, CLEAN_AUTO)).toBe("FAIL");
    }
  });

  it("fails when the reader reported a visual or ghost problem", () => {
    expect(overallVerdict({ ...CLEAN_ANSWERS, visual: "issue" }, CLEAN_AUTO)).toBe("FAIL");
    expect(overallVerdict({ ...CLEAN_ANSWERS, ghost: "issue" }, CLEAN_AUTO)).toBe("FAIL");
  });

  it("is partial — not a pass — when an answer is missing or unsure", () => {
    expect(overallVerdict({ ...CLEAN_ANSWERS, visual: null }, CLEAN_AUTO)).toBe("PARTIAL");
    const unsure = { ...CLEAN_ANSWERS, listen: { ...CLEAN_ANSWERS.listen, slide: "unsure" as const } };
    expect(overallVerdict(unsure, CLEAN_AUTO)).toBe("PARTIAL");
  });

  it.each([
    ["the selection never opened", { selectionOpened: false }],
    ["the more sheet was never seen", { moreSheetOpened: false }],
    ["the selection was never cancelled", { selectionCancelled: false }],
    ["the ghost was not a full chord", { ghostVoices: 2 }],
    ["nothing was ever played", { played: false }],
    ["nothing was seeked", { seekedBarIndex: null }],
    ["the loop was never seen", { loopSeen: false }],
    ["the tempo was never changed", { tempoChanged: false }],
  ])("is partial when %s", (_name, missing) => {
    expect(overallVerdict(CLEAN_ANSWERS, { ...CLEAN_AUTO, ...missing })).toBe("PARTIAL");
  });
});

describe("formatResult", () => {
  const clean = formatResult({
    device: DEVICE,
    answers: CLEAN_ANSWERS,
    observed: CLEAN_AUTO,
  });

  it("opens with the title and closes with the verdict", () => {
    const lines = clean.split("\n");
    expect(lines[0]).toBe("ARANJÉ ANDROID PHYSICAL ACCEPTANCE");
    expect(lines.at(-1)).toBe("Overall: PASS");
  });

  it("carries a line for every one of the six techniques", () => {
    for (const title of ["HO/PO", "Slide", "Bend ½", "Bend 1", "Vibrato", "Palm mute"]) {
      expect(clean).toContain(`${title}: Net duydum`);
    }
  });

  /*
   * The one line the reader cannot supply and the page must not invent. An
   * Android version is reported when the user agent states one, and is a dash
   * when it does not — never inferred from anything else the browser said.
   */
  it("reads the Android version out of the user agent, or says nothing", () => {
    expect(clean).toContain("Android: 14");
    const desktop = formatResult({
      device: { ...DEVICE, userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/126" },
      answers: CLEAN_ANSWERS,
      observed: CLEAN_AUTO,
    });
    expect(desktop).toContain("Android: —");
  });

  it("marks an answer about a passage the playhead never reached", () => {
    const text = formatResult({
      device: DEVICE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, heard: { ...CLEAN_AUTO.heard, palmMute: false } },
    });
    expect(text).toContain("Palm mute: Net duydum (bu bölüm çalınmadı)");
    expect(text).toContain("Vibrato: Net duydum\n");
  });

  it("reports missing timings as a dash rather than a zero", () => {
    const text = formatResult({
      device: { ...DEVICE, loadMs: null, firstSoundMs: null },
      answers: CLEAN_ANSWERS,
      observed: CLEAN_AUTO,
    });
    expect(text).toContain("load — · first sound —");
  });

  it("names the seeked bar in reading numbering, and says ISSUE when there was none", () => {
    expect(clean).toContain("Seek: PASS (2. ölçü)");
    const text = formatResult({
      device: DEVICE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, seekedBarIndex: null },
    });
    expect(text).toContain("Seek: ISSUE");
  });

  it("states the ghost measurement beside the reader's own answer", () => {
    expect(clean).toContain("Power ghost: PASS (otomatik: 3/3 ses, yazma yok)");
    const wrote = formatResult({
      device: DEVICE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, ghostWroteNothing: false },
    });
    expect(wrote).toContain("yazma VAR");
  });

  it("counts errors and shows the first few, rather than hiding them", () => {
    const text = formatResult({
      device: DEVICE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, errors: ["a", "b", "c", "d"] },
    });
    expect(text).toContain("Automatic errors: 4 — a | b | c");
    expect(text).toContain("Overall: FAIL");
  });

  it("keeps the reader's note, or a dash when they wrote none", () => {
    expect(clean).toContain("User note: —");
    const noted = formatResult({
      device: DEVICE,
      answers: { ...CLEAN_ANSWERS, note: "  bend biraz kısık  " },
      observed: CLEAN_AUTO,
    });
    expect(noted).toContain("User note: bend biraz kısık");
  });

  /*
   * Nothing in the block may be somewhere to send it or someone to send it to.
   * The `@` in "412×915 @2.625x" is a pixel ratio, so the check is for an
   * address rather than for the character.
   */
  it("contains no endpoint and no address", () => {
    expect(clean).not.toMatch(/https?:\/\//);
    expect(clean).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

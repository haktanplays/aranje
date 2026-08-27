import { describe, expect, it } from "vitest";

import { foldTransport } from "@/lib/acceptance/transitions";
import {
  LISTEN_KEYS,
  formatResult,
  physicalEvidence,
  verdicts,
  type AcceptanceAnswers,
  type AcceptanceAuto,
  type AcceptanceDevice,
  type ListenKey,
} from "@/lib/acceptance/report";

const everyKey = <T,>(value: T): Readonly<Record<ListenKey, T>> =>
  Object.fromEntries(LISTEN_KEYS.map((key) => [key, value])) as Record<ListenKey, T>;

/* A whole clean transport session, folded the way the watcher folds it. */
const CLEAN_TRANSPORT = foldTransport([
  { status: "idle", ticks: 0, barIndex: 0, loopOn: false, percent: 100, offersPlay: true },
  { status: "playing", ticks: 40, barIndex: 0, loopOn: false, percent: 100, offersPlay: false },
  { status: "paused", ticks: 90, barIndex: 0, loopOn: false, percent: 100, offersPlay: true },
  { status: "playing", ticks: 95, barIndex: 0, loopOn: false, percent: 100, offersPlay: false },
  { status: "paused", ticks: 120, barIndex: 0, loopOn: false, percent: 100, offersPlay: true },
  { status: "paused", ticks: 256, barIndex: 1, loopOn: false, percent: 100, offersPlay: true },
  { status: "paused", ticks: 256, barIndex: 1, loopOn: true, percent: 100, offersPlay: true },
  { status: "paused", ticks: 256, barIndex: 1, loopOn: true, percent: 70, offersPlay: true },
  { status: "paused", ticks: 0, barIndex: 0, loopOn: true, percent: 70, offersPlay: true },
]);

const CLEAN_AUTO: AcceptanceAuto = {
  selectionOpened: true,
  moreSheetOpened: true,
  selectionCancelled: true,
  ghostVoices: 3,
  ghostWrite: { kind: "nothing_written" },
  transport: CLEAN_TRANSPORT,
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

const PHONE: AcceptanceDevice = {
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

/* The machine the live run actually happened on. */
const DESKTOP: AcceptanceDevice = {
  ...PHONE,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0.0.0",
  platform: "MacIntel",
  viewport: "1363×936",
  pixelRatio: 2,
  touchPoints: 0,
};

describe("physicalEvidence", () => {
  it("sees a real Android phone with a real finger", () => {
    expect(physicalEvidence(PHONE)).toEqual({ android: true, touch: true });
  });

  it("sees the live run for what it was: neither", () => {
    expect(physicalEvidence(DESKTOP)).toEqual({ android: false, touch: false });
  });

  /*
   * A user agent is a claim, not a device. Both halves are required precisely
   * so that spoofing one of them is not enough.
   */
  it("does not take a borrowed user agent as a phone", () => {
    expect(physicalEvidence({ ...DESKTOP, userAgent: PHONE.userAgent })).toEqual({
      android: true,
      touch: false,
    });
  });
});

describe("verdicts", () => {
  it("passes all three only on a real device with everything done", () => {
    expect(verdicts(CLEAN_ANSWERS, CLEAN_AUTO, PHONE)).toMatchObject({
      functional: "PASS",
      listening: "PASS",
      physical: "PASS",
      overall: "PASS",
    });
  });

  /*
   * The rule the live run needed most: a desktop browser cannot produce a
   * physical pass, however clean everything else was.
   */
  it("never calls a desktop run a physical pass", () => {
    const decision = verdicts(CLEAN_ANSWERS, CLEAN_AUTO, DESKTOP);
    expect(decision.functional).toBe("PASS");
    expect(decision.physical).toBe("PARTIAL");
    expect(decision.overall).toBe("PARTIAL");
    expect(decision.reasons).toContain("Android olmayan tarayıcı");
    expect(decision.reasons).toContain("dokunmatik olmayan ortam");
  });

  it("fails functionally when the ghost actually wrote something", () => {
    const decision = verdicts(
      CLEAN_ANSWERS,
      { ...CLEAN_AUTO, ghostWrite: { kind: "written", notesAdded: 3 } },
      PHONE,
    );
    expect(decision.functional).toBe("FAIL");
    expect(decision.overall).toBe("FAIL");
  });

  it("fails functionally when the write evidence disagrees with itself", () => {
    const decision = verdicts(
      CLEAN_ANSWERS,
      { ...CLEAN_AUTO, ghostWrite: { kind: "inconsistent", detail: "x" } },
      PHONE,
    );
    expect(decision.functional).toBe("FAIL");
  });

  it.each([
    ["an uncaught error", { errors: ["TypeError: boom"] }],
    ["a mutated device store", { storageUnchanged: false }],
    ["sounds that never loaded", { stuckLoading: true }],
  ])("fails functionally on %s", (_name, broken) => {
    expect(verdicts(CLEAN_ANSWERS, { ...CLEAN_AUTO, ...broken }, PHONE).functional).toBe(
      "FAIL",
    );
  });

  /*
   * The whole live transport section: every control was used, the watcher saw
   * none of it. With an empty log that is a PARTIAL with named reasons, never
   * a pass — and never a silent one.
   */
  it("is partial, with reasons, when the transport was never observed", () => {
    const decision = verdicts(
      CLEAN_ANSWERS,
      { ...CLEAN_AUTO, transport: foldTransport([]) },
      PHONE,
    );
    expect(decision.functional).toBe("PARTIAL");
    expect(decision.reasons).toContain("hiç çalınmadı");
    expect(decision.reasons).toContain("başa sarılmadı");
  });

  it("is partial when the ghost showed fewer than three voices", () => {
    const decision = verdicts(CLEAN_ANSWERS, { ...CLEAN_AUTO, ghostVoices: 0 }, PHONE);
    expect(decision.functional).toBe("PARTIAL");
    expect(decision.reasons).toContain("hayalet 0/3 ses");
  });

  it("fails listening when a technique came back wrong or silent", () => {
    for (const value of ["silent", "wrong"] as const) {
      const answers = {
        ...CLEAN_ANSWERS,
        listen: { ...CLEAN_ANSWERS.listen, vibrato: value },
      };
      expect(verdicts(answers, CLEAN_AUTO, PHONE).listening).toBe("FAIL");
    }
  });

  it("never turns an unsure answer into a positive one", () => {
    const unsure = {
      ...CLEAN_ANSWERS,
      listen: { ...CLEAN_ANSWERS.listen, slide: "unsure" as const },
    };
    expect(verdicts(unsure, CLEAN_AUTO, PHONE).listening).toBe("PARTIAL");
    expect(verdicts(unsure, CLEAN_AUTO, PHONE).overall).toBe("PARTIAL");
  });

  /*
   * The six "Belirsiz (bu bölüm çalınmadı)" lines from the live run. An
   * answer about music that never played is not an answer, whatever was
   * clicked — so a listening pass is impossible here even if every answer had
   * been "Net duydum".
   */
  it("refuses a listening pass for passages the playhead never reached", () => {
    const decision = verdicts(
      CLEAN_ANSWERS,
      { ...CLEAN_AUTO, heard: everyKey(false) },
      PHONE,
    );
    expect(decision.listening).toBe("PARTIAL");
    expect(decision.reasons).toContain("6 pasaj hiç çalınmadı");
    expect(decision.physical).toBe("PARTIAL");
  });
});

describe("formatResult", () => {
  const clean = formatResult({
    device: PHONE,
    answers: CLEAN_ANSWERS,
    observed: CLEAN_AUTO,
  });

  it("opens with the title and closes with the overall verdict", () => {
    const lines = clean.split("\n");
    expect(lines[0]).toBe("ARANJÉ ANDROID PHYSICAL ACCEPTANCE");
    expect(lines.at(-1)).toBe("Overall: PASS");
  });

  it("reports the three verdicts separately", () => {
    expect(clean).toContain("Functional: PASS");
    expect(clean).toContain("Listening: PASS");
    expect(clean).toContain("Physical environment: PASS (Android evet · touch 5)");
  });

  it("carries a line for every one of the six techniques", () => {
    for (const title of ["HO/PO", "Slide", "Bend ½", "Bend 1", "Vibrato", "Palm mute"]) {
      expect(clean).toContain(`${title}: Net duydum`);
    }
  });

  it("shows the transport as the sequence it was, not as a set of flags", () => {
    expect(clean).toContain(
      "Transport sırası: play → pause → resume → seek → loop → tempo → rewind",
    );
    expect(clean).toContain("Tempo: PASS (%70)");
    expect(clean).toContain("Seek: PASS (2. ölçü)");
    expect(clean).toContain("Rewind: PASS");
  });

  /*
   * The two lines that could not both be true in the live block. The write
   * question now has one answer, and it comes from the evidence.
   */
  it("cannot print a write and no mutation at the same time", () => {
    expect(clean).toContain("yazma yok");
    expect(clean).toContain("Storage/history mutation: none");

    const wrote = formatResult({
      device: PHONE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, ghostWrite: { kind: "written", notesAdded: 3 } },
    });
    expect(wrote).toContain("yazma VAR (3 nota)");
    expect(wrote).toContain("Overall: FAIL");
  });

  it("names an inconsistency rather than picking a side", () => {
    const text = formatResult({
      device: PHONE,
      answers: CLEAN_ANSWERS,
      observed: {
        ...CLEAN_AUTO,
        ghostWrite: { kind: "inconsistent", detail: "song değişti ama history büyümedi" },
      },
    });
    expect(text).toContain("TUTARSIZ: song değişti ama history büyümedi");
  });

  it("reads the Android version out of the user agent, or says nothing", () => {
    expect(clean).toContain("Android: 14");
    expect(
      formatResult({ device: DESKTOP, answers: CLEAN_ANSWERS, observed: CLEAN_AUTO }),
    ).toContain("Android: —");
  });

  it("marks an answer about a passage the playhead never reached", () => {
    const text = formatResult({
      device: PHONE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, heard: { ...CLEAN_AUTO.heard, palmMute: false } },
    });
    expect(text).toContain("Palm mute: Net duydum (bu bölüm çalınmadı)");
    expect(text).toContain("Vibrato: Net duydum\n");
  });

  it("reports missing timings as a dash rather than a zero", () => {
    const text = formatResult({
      device: { ...PHONE, loadMs: null, firstSoundMs: null },
      answers: CLEAN_ANSWERS,
      observed: CLEAN_AUTO,
    });
    expect(text).toContain("load — · first sound —");
  });

  it("counts errors and shows the first few, rather than hiding them", () => {
    const text = formatResult({
      device: PHONE,
      answers: CLEAN_ANSWERS,
      observed: { ...CLEAN_AUTO, errors: ["a", "b", "c", "d"] },
    });
    expect(text).toContain("Automatic errors: 4 — a | b | c");
    expect(text).toContain("Overall: FAIL");
  });

  it("keeps the reader's note, or a dash when they wrote none", () => {
    expect(clean).toContain("User note: —");
    expect(
      formatResult({
        device: PHONE,
        answers: { ...CLEAN_ANSWERS, note: "  bend biraz kısık  " },
        observed: CLEAN_AUTO,
      }),
    ).toContain("User note: bend biraz kısık");
  });

  it("says why, whenever it is not a clean pass", () => {
    const text = formatResult({
      device: DESKTOP,
      answers: CLEAN_ANSWERS,
      observed: CLEAN_AUTO,
    });
    expect(text).toMatch(/Notlar: .*Android olmayan/);
    expect(clean).toContain("Notlar: —");
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

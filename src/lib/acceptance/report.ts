/**
 * The result the guided Android test hands back (K-59.1 §5 Adım 7).
 *
 * One block of plain text, built on the device and copied by the reader. No
 * request leaves the phone: there is no endpoint here, no analytics, and
 * nothing personal — the device lines are what the browser volunteers to any
 * page, and the answers are the reader's own words about their own test.
 *
 * The verdict is computed, not typed. A run where something the harness
 * *measured* went wrong cannot be reported as a pass because the person
 * clicking through felt generous, and a run where a listening answer is
 * missing is not a pass either — it is a partial, and it says so.
 */

/** What the reader answered about a technique they listened to. */
export type ListenAnswer = "clear" | "unsure" | "wrong" | "silent" | null;

/** What the reader answered about something they looked at or did. */
export type CheckAnswer = "ok" | "issue" | null;

export const LISTEN_LABELS: Readonly<Record<Exclude<ListenAnswer, null>, string>> = {
  clear: "Net duydum",
  unsure: "Belirsiz",
  wrong: "Yanlış geldi",
  silent: "Ses çıkmadı",
};

/** Every technique the scheduler really plays differently, in listening order. */
export const LISTEN_KEYS = [
  "hopo",
  "slide",
  "bendHalf",
  "bendFull",
  "vibrato",
  "palmMute",
] as const;

export type ListenKey = (typeof LISTEN_KEYS)[number];

export const LISTEN_TITLES: Readonly<Record<ListenKey, string>> = {
  hopo: "HO/PO",
  slide: "Slide",
  bendHalf: "Bend ½",
  bendFull: "Bend 1",
  vibrato: "Vibrato",
  palmMute: "Palm mute",
};

export type AcceptanceDevice = {
  readonly date: string;
  readonly userAgent: string;
  readonly platform: string;
  readonly viewport: string;
  readonly pixelRatio: number;
  readonly touchPoints: number;
  readonly reducedMotion: boolean;
  readonly online: boolean;
  readonly audioState: string;
  /** Milliseconds from the first tap to every buffer decoded, or null. */
  readonly loadMs: number | null;
  /** Milliseconds from the first tap to the transport actually playing. */
  readonly firstSoundMs: number | null;
  readonly buffers: string;
};

/** What the page watched while the reader worked, with nobody asked. */
export type AcceptanceAuto = {
  readonly selectionOpened: boolean;
  readonly moreSheetOpened: boolean;
  readonly selectionCancelled: boolean;
  readonly ghostVoices: number;
  readonly ghostWroteNothing: boolean;
  readonly played: boolean;
  readonly paused: boolean;
  readonly resumed: boolean;
  readonly seekedBarIndex: number | null;
  readonly loopSeen: boolean;
  readonly tempoChanged: boolean;
  /**
   * The engine says it is playing while the button still offers to play, for
   * long enough that it is not a transition — the shape a second transport
   * would take.
   */
  readonly transportDesync: boolean;
  readonly stuckLoading: boolean;
  readonly errors: readonly string[];
  /** True when the playhead really crossed each technique's own window. */
  readonly heard: Readonly<Record<ListenKey, boolean>>;
  /**
   * Byte-equal proof: what `localStorage` held before the fixture mounted and
   * what it holds now.
   *
   * One measurement covers both the reader's music and their history, because
   * the history is session-only and never reaches storage (K-44) — so if this
   * test could cost them an undo step, it could only do so by writing a song,
   * which is exactly what this compares. A second boolean saying the same
   * thing would be a check nothing could ever fail on its own.
   */
  readonly storageUnchanged: boolean;
};

export type AcceptanceAnswers = {
  readonly visual: CheckAnswer;
  readonly ghost: CheckAnswer;
  readonly listen: Readonly<Record<ListenKey, ListenAnswer>>;
  readonly note: string;
};

const mark = (value: CheckAnswer): string =>
  value === "ok" ? "PASS" : value === "issue" ? "ISSUE" : "—";

const auto = (ok: boolean): string => (ok ? "PASS" : "ISSUE");

/**
 * PASS, PARTIAL or FAIL, from what was measured and what was answered.
 *
 * FAIL when something objective broke: an uncaught error, a mutated store, a
 * technique that came back silent or wrong. PARTIAL when the run is simply
 * incomplete, or when a person was unsure. PASS only when every measured thing
 * held and every answer was given.
 */
export function overallVerdict(
  answers: AcceptanceAnswers,
  observed: AcceptanceAuto,
): "PASS" | "PARTIAL" | "FAIL" {
  const listened = LISTEN_KEYS.map((key) => answers.listen[key]);
  const broke =
    observed.errors.length > 0 ||
    !observed.storageUnchanged ||
    observed.transportDesync ||
    observed.stuckLoading ||
    answers.visual === "issue" ||
    answers.ghost === "issue" ||
    listened.some((value) => value === "wrong" || value === "silent");
  if (broke) return "FAIL";

  const incomplete =
    answers.visual === null ||
    answers.ghost === null ||
    listened.some((value) => value === null) ||
    listened.some((value) => value === "unsure") ||
    !observed.selectionOpened ||
    !observed.moreSheetOpened ||
    !observed.selectionCancelled ||
    observed.ghostVoices !== 3 ||
    !observed.played ||
    !observed.paused ||
    !observed.resumed ||
    observed.seekedBarIndex === null ||
    !observed.loopSeen ||
    !observed.tempoChanged;
  return incomplete ? "PARTIAL" : "PASS";
}

/** The block the reader copies. Nothing here is sent anywhere. */
export function formatResult(input: {
  readonly device: AcceptanceDevice;
  readonly answers: AcceptanceAnswers;
  readonly observed: AcceptanceAuto;
}): string {
  const { device, answers, observed } = input;
  const listened = (key: ListenKey): string => {
    const value = answers.listen[key];
    const said = value ? LISTEN_LABELS[value] : "—";
    // A judgement about music the playhead never reached is not a judgement.
    return observed.heard[key] ? said : `${said} (bu bölüm çalınmadı)`;
  };

  return [
    "ARANJÉ ANDROID PHYSICAL ACCEPTANCE",
    `Date: ${device.date}`,
    `Device: ${device.platform || "—"}`,
    `Android: ${androidVersion(device.userAgent)}`,
    `Browser: ${device.userAgent}`,
    `Viewport: ${device.viewport} @${device.pixelRatio}x · touch ${device.touchPoints} · reduced-motion ${device.reducedMotion ? "on" : "off"} · ${device.online ? "online" : "offline"}`,
    `Audio output: ${device.audioState} · ${device.buffers} · load ${ms(device.loadMs)} · first sound ${ms(device.firstSoundMs)}`,
    `Visual: ${mark(answers.visual)}`,
    `Selection: ${auto(observed.selectionOpened)}`,
    `More sheet: ${auto(observed.moreSheetOpened)}`,
    `Power ghost: ${mark(answers.ghost)} (otomatik: ${observed.ghostVoices}/3 ses, yazma ${observed.ghostWroteNothing ? "yok" : "VAR"})`,
    `Play-pause: ${auto(observed.played && observed.paused && observed.resumed)}`,
    `Seek: ${observed.seekedBarIndex === null ? "ISSUE" : `PASS (${observed.seekedBarIndex + 1}. ölçü)`}`,
    `Loop: ${auto(observed.loopSeen)}`,
    `Tempo: ${auto(observed.tempoChanged)}`,
    `HO/PO: ${listened("hopo")}`,
    `Slide: ${listened("slide")}`,
    `Bend ½: ${listened("bendHalf")}`,
    `Bend 1: ${listened("bendFull")}`,
    `Vibrato: ${listened("vibrato")}`,
    `Palm mute: ${listened("palmMute")}`,
    `Automatic errors: ${observed.errors.length === 0 ? "0" : `${observed.errors.length} — ${observed.errors.slice(0, 3).join(" | ")}`}`,
    `Storage/history mutation: ${observed.storageUnchanged ? "none" : "DETECTED"}`,
    `User note: ${answers.note.trim() || "—"}`,
    `Overall: ${overallVerdict(answers, observed)}`,
  ].join("\n");
}

const ms = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value)}ms`;

/** What the user agent says, when it says it. Never guessed. */
function androidVersion(userAgent: string): string {
  const found = /Android\s+([\d.]+)/.exec(userAgent);
  return found?.[1] ?? "—";
}

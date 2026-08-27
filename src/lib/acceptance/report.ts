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

import { BRAND_NAME } from "@/lib/brand";
import { writeLine, type WriteVerdict } from "@/lib/acceptance/evidence";
import type { TransportLog } from "@/lib/acceptance/transitions";

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
  /**
   * What the ghost actually did to the song, judged from five sources rather
   * than from how many numbers were on screen (§6). A preview draws numbers;
   * drawing is not writing.
   */
  readonly ghostWrite: WriteVerdict;
  /** Every transport transition, in the order the reader made it happen. */
  readonly transport: TransportLog;
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

export type Verdict = "PASS" | "PARTIAL" | "FAIL";

export type Verdicts = {
  /** The route, the selection, the ghost, the transport and the isolation. */
  readonly functional: Verdict;
  /** What the reader said they heard. */
  readonly listening: Verdict;
  /** Whether this was a real Android phone with a real finger on it. */
  readonly physical: Verdict;
  readonly overall: Verdict;
  /** Why it is not a PASS, in the reader's language. */
  readonly reasons: readonly string[];
};

/**
 * A real phone with a real finger, or not (§8).
 *
 * Both halves are required and neither is inferable from the other: a desktop
 * Chromium can be told to send an Android user agent, and a touchscreen laptop
 * is not an Android phone. The live run that prompted this was a `1363x936`
 * MacIntel Chrome with `touch=0`, and the honest answer for it is that the
 * physical question was not asked at all.
 */
export function physicalEvidence(device: AcceptanceDevice): {
  readonly android: boolean;
  readonly touch: boolean;
} {
  return {
    android: /Android\s+[\d.]/.test(device.userAgent),
    touch: device.touchPoints > 0,
  };
}

/**
 * Three questions, answered separately, and then the worst of them (§8).
 *
 * They are separate because they fail for different reasons and are fixed by
 * different people. A functional defect is a bug in the app. A missing
 * listening answer is a test that was not finished. A desktop browser is not
 * a defect at all — it is simply not the thing the physical round is about,
 * and reporting it as a pass would be the single most misleading line this
 * block could contain.
 */
export function verdicts(
  answers: AcceptanceAnswers,
  observed: AcceptanceAuto,
  device: AcceptanceDevice,
): Verdicts {
  const reasons: string[] = [];
  const transport = observed.transport;

  /* ------------------------------------------------------------ functional */
  const functionalBroke: readonly [boolean, string][] = [
    [observed.errors.length > 0, `sayfada ${observed.errors.length} hata`],
    [!observed.storageUnchanged, "cihaz deposu değişti"],
    [transport.desync, "motor çalıyor ama düğme hâlâ Çal diyor"],
    [observed.stuckLoading, "sesler yüklenmedi"],
    [observed.ghostWrite.kind !== "nothing_written", `hayalet: ${writeLine(observed.ghostWrite)}`],
    [answers.visual === "issue", "okuyucu görünümde sorun bildirdi"],
    [answers.ghost === "issue", "okuyucu hayalette sorun bildirdi"],
  ];
  const functionalMissing: readonly [boolean, string][] = [
    [!observed.selectionOpened, "seçim açılmadı"],
    [!observed.moreSheetOpened, "Daha fazla açılmadı"],
    [!observed.selectionCancelled, "seçim iptal edilmedi"],
    [observed.ghostVoices !== 3, `hayalet ${observed.ghostVoices}/3 ses`],
    [!transport.played, "hiç çalınmadı"],
    [!transport.paused, "duraklatılmadı"],
    [!transport.resumed, "yeniden başlatılmadı"],
    [transport.seekedBarIndex === null, "ölçüye atlanmadı"],
    [!transport.loopSeen, "döngü açılmadı"],
    [transport.tempoPercent === null, "hız değiştirilmedi"],
    [!transport.rewound, "başa sarılmadı"],
    [answers.visual === null, "görünüm cevaplanmadı"],
    [answers.ghost === null, "hayalet cevaplanmadı"],
  ];
  for (const [hit, why] of [...functionalBroke, ...functionalMissing]) {
    if (hit) reasons.push(why);
  }
  const functional: Verdict = functionalBroke.some(([hit]) => hit)
    ? "FAIL"
    : functionalMissing.some(([hit]) => hit)
      ? "PARTIAL"
      : "PASS";

  /* ------------------------------------------------------------- listening */
  const said = LISTEN_KEYS.map((key) => answers.listen[key]);
  /*
   * An answer about a passage the playhead never reached is not an answer,
   * whatever the reader clicked. "Belirsiz" is never turned into anything
   * positive, and a browser cannot report that the sound was good.
   */
  const unheard = LISTEN_KEYS.filter((key) => !observed.heard[key]);
  const listeningBroke = said.some((value) => value === "wrong" || value === "silent");
  const listeningMissing =
    unheard.length > 0 ||
    said.some((value) => value === null || value === "unsure");
  if (listeningBroke) reasons.push("bir teknik yanlış veya sessiz geldi");
  if (unheard.length > 0) reasons.push(`${unheard.length} pasaj hiç çalınmadı`);
  const listening: Verdict = listeningBroke
    ? "FAIL"
    : listeningMissing
      ? "PARTIAL"
      : "PASS";

  /* --------------------------------------------------------------- physical */
  const evidence = physicalEvidence(device);
  if (!evidence.android) reasons.push("Android olmayan tarayıcı");
  if (!evidence.touch) reasons.push("dokunmatik olmayan ortam");
  const physical: Verdict =
    evidence.android && evidence.touch && listening === "PASS" && functional === "PASS"
      ? "PASS"
      : "PARTIAL";

  /*
   * The overall answer is the worst of the three, and it can never be better
   * than the physical one — which is what stops a clean desktop run from
   * reading as a finished physical acceptance.
   */
  const overall: Verdict = [functional, listening, physical].includes("FAIL")
    ? "FAIL"
    : [functional, listening, physical].includes("PARTIAL")
      ? "PARTIAL"
      : "PASS";

  return { functional, listening, physical, overall, reasons };
}

/** The block the reader copies. Nothing here is sent anywhere. */
export function formatResult(input: {
  readonly device: AcceptanceDevice;
  readonly answers: AcceptanceAnswers;
  readonly observed: AcceptanceAuto;
}): string {
  const { device, answers, observed } = input;
  const t = observed.transport;
  const decision = verdicts(answers, observed, device);
  const evidence = physicalEvidence(device);
  const listened = (key: ListenKey): string => {
    const value = answers.listen[key];
    const said = value ? LISTEN_LABELS[value] : "—";
    // A judgement about music the playhead never reached is not a judgement.
    return observed.heard[key] ? said : `${said} (bu bölüm çalınmadı)`;
  };

  return [
    `${BRAND_NAME.toUpperCase()} ANDROID PHYSICAL ACCEPTANCE`,
    `Date: ${device.date}`,
    `Device: ${device.platform || "—"}`,
    `Android: ${androidVersion(device.userAgent)}`,
    `Browser: ${device.userAgent}`,
    `Viewport: ${device.viewport} @${device.pixelRatio}x · touch ${device.touchPoints} · reduced-motion ${device.reducedMotion ? "on" : "off"} · ${device.online ? "online" : "offline"}`,
    `Audio output: ${device.audioState} · ${device.buffers} · load ${ms(device.loadMs)} · first sound ${ms(device.firstSoundMs)}`,
    `Visual: ${mark(answers.visual)}`,
    `Selection: ${auto(observed.selectionOpened)}`,
    `More sheet: ${auto(observed.moreSheetOpened)}`,
    `Power ghost: ${mark(answers.ghost)} (otomatik: ${observed.ghostVoices}/3 ses, ${writeLine(observed.ghostWrite)})`,
    `Play-pause: ${auto(t.played && t.paused && t.resumed)}`,
    `Seek: ${t.seekedBarIndex === null ? "ISSUE" : `PASS (${t.seekedBarIndex + 1}. ölçü)`}`,
    `Loop: ${auto(t.loopSeen)}`,
    `Tempo: ${t.tempoPercent === null ? "ISSUE" : `PASS (%${t.tempoPercent})`}`,
    `Rewind: ${auto(t.rewound)}`,
    `Transport sırası: ${t.order.length === 0 ? "—" : t.order.join(" → ")}`,
    `HO/PO: ${listened("hopo")}`,
    `Slide: ${listened("slide")}`,
    `Bend ½: ${listened("bendHalf")}`,
    `Bend 1: ${listened("bendFull")}`,
    `Vibrato: ${listened("vibrato")}`,
    `Palm mute: ${listened("palmMute")}`,
    `Automatic errors: ${observed.errors.length === 0 ? "0" : `${observed.errors.length} — ${observed.errors.slice(0, 3).join(" | ")}`}`,
    `Storage/history mutation: ${observed.storageUnchanged ? "none" : "DETECTED"}`,
    `User note: ${answers.note.trim() || "—"}`,
    `Functional: ${decision.functional}`,
    `Listening: ${decision.listening}`,
    `Physical environment: ${decision.physical} (Android ${evidence.android ? "evet" : "hayır"} · touch ${device.touchPoints})`,
    decision.reasons.length === 0
      ? "Notlar: —"
      : `Notlar: ${decision.reasons.join(" · ")}`,
    `Overall: ${decision.overall}`,
  ].join("\n");
}

const ms = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value)}ms`;

/** What the user agent says, when it says it. Never guessed. */
function androidVersion(userAgent: string): string {
  const found = /Android\s+([\d.]+)/.exec(userAgent);
  return found?.[1] ?? "—";
}

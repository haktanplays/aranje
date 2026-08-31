"use client";

/**
 * What the page notices while the founder edits (2U-A handoff §5).
 *
 * ## Where the numbers come from
 *
 * Two of them, and neither is a count this page keeps for itself:
 *
 * - **The song's own bytes**, read out of the storage the route owns. What is
 *   in that storage *is* the fixture, so comparing it before and after a
 *   gesture is the same question a project file would ask.
 * - **The record's revision.** The app writes the project record once per
 *   committed edit, so a revision that moved by one is one history step and
 *   one storage write — said by the thing that did them.
 *
 * Counting writes with a wrapper around `setItem` would have measured this
 * page's opinion of what a write is. The revision is the app's.
 *
 * ## Why the selection is measured as a rectangle
 *
 * "Did the selection get wider" is a question about a band on screen, and the
 * band's width in pixels is the only honest answer available from outside the
 * component. It is deliberately not read from any internal state: a route that
 * reached into the workspace's own hooks would be testing a private field
 * rather than the thing the reader can see.
 */
import { useCallback, useEffect, useState } from "react";

import { deviceStorageSnapshot } from "@/lib/acceptance/device-storage";
import { readFixture } from "@/lib/acceptance/fixture-read";
import type { MemoryStorage } from "@/lib/acceptance/memory-storage";

/**
 * Words that only a whole-measure selection may offer (2U-A §10, 2U-B §10).
 *
 * Written against the labels the product actually draws, and case-insensitively
 * — the previous version looked for "Ölçü ekle" with a capital Ö and the
 * button says "Önüne ölçü ekle", so it matched nothing and the whole
 * measure/note distinction reported "—" for a run that had opened both.
 */
const MEASURE_WORDS = /ölçü ekle|ölçüyü kaldır|ölçüyü taşı|ölçüyü çoğalt|ölçü ve ritim|kopyalanan ölçüleri/i;

/** What a note selection must be able to reach, when there is a clipboard. */
const PASTE_LABEL = "Yapıştır";

/** Whether a control is on screen and not refusing to be pressed. */
function runnable(node: Element | null | undefined): boolean {
  if (!node) return false;
  if (node instanceof HTMLButtonElement && node.disabled) return false;
  return node.getAttribute("aria-disabled") !== "true";
}

export type EditorSnapshot = {
  readonly song: string;
  readonly revision: number;
  /** Width of the time-selection band, or null when nothing is selected. */
  readonly band: number | null;
};

export type StandingObservations = {
  /** A note or range selection was open and offered no measure verb. */
  readonly noteHidesMeasureVerbs: boolean | null;
  /**
   * A note selection offered a paste that could actually be pressed.
   *
   * Visibility *and* `canRun`, because a greyed control is not a reachable
   * verb — and because the founder's clipboard defect was precisely a verb
   * the model offered and no surface drew (2U-B §3, §10).
   */
  readonly noteOffersPaste: boolean | null;
  /** One instrument's bars were held and offered no bar-adding verb. */
  readonly trackBarHidesInsert: boolean | null;
  /** The whole measure was held and its bar-adding verb could be pressed. */
  readonly wholeMeasureRunsInsert: boolean | null;
  /** No dialog was ever opened with nothing inside it (2U-B §6). */
  readonly noEmptyDialog: boolean | null;
  /** A run of two bars was really held, not one described as two (§9). */
  readonly twoBarsHeld: boolean | null;
  /** A refusal showed the typed playability sentence rather than nothing. */
  readonly stringRefusalTyped: boolean | null;
  /** No "Yerine koy" appeared on a refusal no overwrite can answer (§7). */
  readonly noUnhonouredReplace: boolean | null;
  /** The old pattern-continuation tool is still reachable from its door. */
  readonly patternToolReachable: boolean | null;
  /** "Devam" never opened the composer instead of extending. */
  readonly extendComposerClosed: boolean | null;
  readonly sixStringsVisible: boolean | null;
  readonly noNewToolbarRow: boolean | null;
  readonly noBodyOverflow: boolean | null;
  readonly noStaffScroller: boolean | null;
  readonly noTruncatedLabel: boolean | null;
  readonly allTargets44: boolean | null;
};

const EMPTY_STANDING: StandingObservations = {
  noteHidesMeasureVerbs: null,
  noteOffersPaste: null,
  trackBarHidesInsert: null,
  wholeMeasureRunsInsert: null,
  noEmptyDialog: null,
  twoBarsHeld: null,
  stringRefusalTyped: null,
  noUnhonouredReplace: null,
  patternToolReachable: null,
  extendComposerClosed: null,
  sixStringsVisible: null,
  noNewToolbarRow: null,
  noBodyOverflow: null,
  noStaffScroller: null,
  noTruncatedLabel: null,
  allTargets44: null,
};

const bandWidth = (): number | null => {
  const node = document.querySelector("[data-testid=time-selection-band]");
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return box.width > 0 ? Math.round(box.width) : null;
};

/**
 * One pass over the screen.
 *
 * Every answer is "worst seen so far" rather than "true right now": a toolbar
 * that overflowed for one frame overflowed, and a later clean frame does not
 * take that back. Once false, a standing observation stays false.
 *
 * The result is the *same object* when nothing changed. That is not a
 * micro-optimisation: returning a fresh object every 400ms made React
 * re-render the whole route — the real workspace included — four times a
 * second forever, and the four-viewport run found it by never seeing a
 * button stand still long enough to be clicked.
 */
function observeScreen(previous: StandingObservations): StandingObservations {
  const worse = (was: boolean | null, now: boolean): boolean =>
    was === false ? false : now;

  const dialog = document.querySelector("[role=dialog]");
  const dialogText = dialog?.textContent ?? "";
  const noteSelectionOpen = document.querySelector("[data-selection-toolbar]") !== null;
  const barSelectionOpen = document.querySelector("[data-bar-action-bar]") !== null;

  /*
   * Which scope is held, from the control that says so rather than from the
   * summary text (2U-B §10). Reading a sentence to find out what the app
   * thinks is how a measurement ends up testing the wording.
   */
  const scopeNode = document.querySelector("[data-bar-scope][aria-checked=true]");
  const barScope = scopeNode?.getAttribute("data-bar-scope") ?? null;

  let noteHides = previous.noteHidesMeasureVerbs;
  if (noteSelectionOpen && dialog !== null && !barSelectionOpen) {
    noteHides = worse(noteHides, !MEASURE_WORDS.test(dialogText));
  }

  /*
   * The other half of the note scope: not only that the wrong verbs are
   * absent, but that the right ones are there and pressable. "Görünmeyen
   * komutun test edilmemesi PASS değildir" cuts both ways.
   */
  let notePaste = previous.noteOffersPaste;
  if (noteSelectionOpen && dialog !== null && !barSelectionOpen) {
    const entry = [...dialog.querySelectorAll("[data-selection-action]")].find(
      (node) => node.getAttribute("data-selection-action") === PASTE_LABEL,
    );
    if (entry) notePaste = worse(notePaste, runnable(entry));
  }

  /* One instrument's bars may never be offered a way to lengthen the song. */
  let trackHides = previous.trackBarHidesInsert;
  if (barSelectionOpen && barScope === "track" && dialog !== null) {
    trackHides = worse(trackHides, !MEASURE_WORDS.test(dialogText));
  }

  /* The whole measure must offer one, and it must be pressable. */
  let wholeRuns = previous.wholeMeasureRunsInsert;
  if (barSelectionOpen && barScope === "full" && dialog !== null) {
    const insert = dialog.querySelector("[data-testid=bar-more-blank_after]");
    if (insert) wholeRuns = worse(wholeRuns, runnable(insert));
  }

  /*
   * No door may open onto nothing (2U-B §6). Counted rather than read: a
   * sheet whose only control is its own close button is the empty dialog the
   * founder found, however carefully it is titled.
   */
  let noEmpty = previous.noEmptyDialog;
  if (dialog !== null) {
    /*
     * Controls inside the sheet's own panel. The backdrop is a button too —
     * it is how a tap outside dismisses the sheet — and counting it would
     * make every empty dialog look like it held one thing.
     */
    const choices = dialog.querySelectorAll("section button").length;
    noEmpty = worse(noEmpty, choices > 0);
  }

  /*
   * Two bars, said by the selection summary the app writes for itself. The
   * route must not be able to select one bar and report "two" (§9).
   */
  const summary = document.querySelector("[data-bar-summary]")?.textContent ?? "";
  const twoBars = /·\s*2\s+ölçü/.test(summary) ? true : previous.twoBarsHeld;

  /*
   * A refusal that names itself. `transform-preview` carries the command's
   * own sentence when it will not run, and "Uygula" must be shut with it —
   * a refusal the reader can press past is not a refusal (§5).
   */
  let refusalTyped = previous.stringRefusalTyped;
  const preview = document.querySelector("[data-testid=transform-preview]");
  if (preview && /çalınamıyor|hedef tel yok/i.test(preview.textContent ?? "")) {
    const apply = [...document.querySelectorAll("[role=dialog] button")].find(
      (node) => node.textContent?.trim() === "Uygula",
    );
    refusalTyped = worse(refusalTyped, !runnable(apply));
  }

  /*
   * "Yerine koy" must never be drawn on a collision no overwrite answers
   * (§7). The move refusal names itself; if that sentence and the replace
   * button are on screen together, the button is one the core will not
   * honour.
   */
  let honestReplace = previous.noUnhonouredReplace;
  const barPreview = document.querySelector("[data-bar-preview]")?.textContent ?? "";
  if (barPreview.length > 0) {
    const replaceShown = document.querySelector("[data-bar-replace]") !== null;
    const unanswerable = /taşınacak yerde/i.test(barPreview);
    honestReplace = worse(honestReplace, !(unanswerable && replaceShown));
  }

  /*
   * "Devam" must extend rather than pick up the pattern tool. A held door is
   * marked by the door row, so a tool becoming held while the reader was
   * pressing Devam is exactly the failure this looks for.
   */
  const heldDoor = document.querySelector("[data-composer-door-held]");
  const extendClean = worse(
    previous.extendComposerClosed,
    !noteSelectionOpen || heldDoor === null,
  );

  const rhythmDoor = document.querySelector("[data-composer-door=rhythm]");
  const patternReachable =
    rhythmDoor !== null ? true : previous.patternToolReachable;

  const strings = document.querySelectorAll("[data-string-line]").length;
  const sixStrings = strings === 0 ? previous.sixStringsVisible : worse(previous.sixStringsVisible, strings >= 6);

  const toolbarRows = document.querySelectorAll("[data-selection-toolbar]").length;
  const noNewRow = worse(previous.noNewToolbarRow, toolbarRows <= 1);

  const overflow = document.body.scrollWidth - document.body.clientWidth;
  const noOverflow = worse(previous.noBodyOverflow, overflow <= 0);

  /* A scroller inside the staff itself would hide strings behind a swipe. */
  const staffScrollers = [...document.querySelectorAll("[data-tab-content] *")].filter(
    (node) =>
      node.scrollHeight > node.clientHeight + 1 &&
      ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
  ).length;
  const noStaffScroll = worse(previous.noStaffScroller, staffScrollers === 0);

  const controls = [
    ...document.querySelectorAll("[data-selection-toolbar] button, [data-acceptance-action]"),
  ];
  const truncated = controls.filter(
    (node) => node.scrollWidth > node.clientWidth + 1,
  ).length;
  const noTruncation =
    controls.length === 0 ? previous.noTruncatedLabel : worse(previous.noTruncatedLabel, truncated === 0);

  const small = controls.filter((node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && Math.min(box.width, box.height) < 44;
  }).length;
  const targets =
    controls.length === 0 ? previous.allTargets44 : worse(previous.allTargets44, small === 0);

  const next: StandingObservations = {
    noteHidesMeasureVerbs: noteHides,
    noteOffersPaste: notePaste,
    trackBarHidesInsert: trackHides,
    wholeMeasureRunsInsert: wholeRuns,
    noEmptyDialog: noEmpty,
    twoBarsHeld: twoBars,
    stringRefusalTyped: refusalTyped,
    noUnhonouredReplace: honestReplace,
    patternToolReachable: patternReachable,
    extendComposerClosed: extendClean,
    sixStringsVisible: sixStrings,
    noNewToolbarRow: noNewRow,
    noBodyOverflow: noOverflow,
    noStaffScroller: noStaffScroll,
    noTruncatedLabel: noTruncation,
    allTargets44: targets,
  };

  const unchanged = (Object.keys(next) as (keyof StandingObservations)[]).every(
    (key) => next[key] === previous[key],
  );
  return unchanged ? previous : next;
}

/**
 * A reading handle for a browser harness (2V-A §10).
 *
 * The same two numbers this hook already keeps — the song's bytes and the
 * record's revision — put where a Playwright run can see them. Nothing here
 * can drive anything: there is no press, no seek and no playback behind it,
 * which is the line §10 draws when it forbids a test-only playback control.
 *
 * It exists because the alternative is worse. A harness that wrapped
 * `setItem` to count writes would be watching a store this route does not
 * use — the page owns a storage made of a `Map` — and would report a
 * structural zero as a proof, which is exactly the vacuity 2U-C was caught by.
 */
export type AcceptanceReading = {
  /** The stored Song, byte for byte, as the page's own storage holds it. */
  bytes(): string;
  /** One per committed edit: a revision that moved is a command that ran. */
  revision(): number;
};

declare global {
  interface Window {
    __aranjeAcceptance?: AcceptanceReading;
  }
}

export function useEditorWatch(storage: MemoryStorage): {
  readonly standing: StandingObservations;
  readonly consoleErrors: readonly string[];
  readonly userStorageBefore: string;
  /** Read fresh each time it is asked for; the device's store must not move. */
  userStorageNow(): string;
  /** The song and the selection, right now. */
  snapshot(): EditorSnapshot;
} {
  const [standing, setStanding] = useState<StandingObservations>(EMPTY_STANDING);
  const [consoleErrors, setConsoleErrors] = useState<readonly string[]>([]);
  const [userStorageBefore] = useState(() => deviceStorageSnapshot());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStanding((previous) => observeScreen(previous));
    }, 400);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * Errors are collected rather than sampled. A thrown render that recovered
   * still threw, and a report that only looked at the end would miss it.
   */
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setConsoleErrors((current) => [...current, event.message].slice(0, 20));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      setConsoleErrors((current) => [...current, String(event.reason)].slice(0, 20));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  /*
   * Depends on the storage rather than holding it in a ref: the session is
   * installed once and never swapped, so the identity is stable in practice,
   * and reading it straight makes the dependency honest instead of hidden
   * behind a ref written during render.
   */
  const snapshot = useCallback((): EditorSnapshot => {
    const reading = readFixture(storage);
    return { song: reading.song, revision: reading.revision, band: bandWidth() };
  }, [storage]);

  useEffect(() => {
    const reading: AcceptanceReading = {
      bytes: () => JSON.stringify(readFixture(storage).song),
      revision: () => readFixture(storage).revision,
    };
    window.__aranjeAcceptance = reading;
    return () => {
      if (window.__aranjeAcceptance === reading) delete window.__aranjeAcceptance;
    };
  }, [storage]);

  return {
    standing,
    consoleErrors,
    userStorageBefore,
    userStorageNow: deviceStorageSnapshot,
    snapshot,
  };
}

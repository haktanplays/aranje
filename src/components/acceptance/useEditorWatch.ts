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

/** Words that only a whole-bar selection may offer (2U-A §10). */
const MEASURE_WORDS = /Ölçü ekle|Öncesine ölçü|Sonrasına ölçü|Ölçüyü sil|Sola taşı|Sağa taşı|Ölçü ve ritim/;

export type EditorSnapshot = {
  readonly song: string;
  readonly revision: number;
  /** Width of the time-selection band, or null when nothing is selected. */
  readonly band: number | null;
};

export type StandingObservations = {
  /** A note or range selection was open and offered no measure verb. */
  readonly noteHidesMeasureVerbs: boolean | null;
  /** A measure selection was open and did offer them. */
  readonly measureOffersMeasureVerbs: boolean | null;
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
  measureOffersMeasureVerbs: null,
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
 */
function observeScreen(previous: StandingObservations): StandingObservations {
  const worse = (was: boolean | null, now: boolean): boolean =>
    was === false ? false : now;

  const dialog = document.querySelector("[role=dialog]");
  const dialogText = dialog?.textContent ?? "";
  const noteSelectionOpen = document.querySelector("[data-selection-toolbar]") !== null;
  const barSelectionOpen = document.querySelector("[data-bar-action-bar]") !== null;

  let noteHides = previous.noteHidesMeasureVerbs;
  if (noteSelectionOpen && dialog !== null && !barSelectionOpen) {
    noteHides = worse(noteHides, !MEASURE_WORDS.test(dialogText));
  }

  let measureOffers = previous.measureOffersMeasureVerbs;
  if (barSelectionOpen && dialog !== null) {
    /* Only claim it once the sheet that holds them is actually open. */
    if (MEASURE_WORDS.test(dialogText)) measureOffers = true;
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

  return {
    noteHidesMeasureVerbs: noteHides,
    measureOffersMeasureVerbs: measureOffers,
    patternToolReachable: patternReachable,
    extendComposerClosed: extendClean,
    sixStringsVisible: sixStrings,
    noNewToolbarRow: noNewRow,
    noBodyOverflow: noOverflow,
    noStaffScroller: noStaffScroll,
    noTruncatedLabel: noTruncation,
    allTargets44: targets,
  };
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

  return {
    standing,
    consoleErrors,
    userStorageBefore,
    userStorageNow: deviceStorageSnapshot,
    snapshot,
  };
}

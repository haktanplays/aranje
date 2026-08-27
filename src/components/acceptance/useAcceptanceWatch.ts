"use client";

/**
 * What the page notices while the reader works (K-59.1 §6, §7).
 *
 * Two things were wrong with the first version, and a live run on a real
 * browser found both.
 *
 * The transport was read as a set of booleans sampled by a timer, so a
 * transition that happened between two ticks had never happened. That is now
 * a `TransportLog`: the samples are folded into an ordered list of events, and
 * a transition survives being seen once.
 *
 * "Did the ghost write anything" was answered by counting fret numbers on
 * screen, which counts *drawings* — so a preview, which exists precisely to
 * draw numbers without writing them, reported a write. That is now judged from
 * the song's own bytes, the record's revision, the history and the undo
 * control, through `judgeWrite`.
 *
 * The song is read out of the page's own storage rather than from the engine,
 * because the guided route owns that storage: what is in it *is* the fixture,
 * and comparing it before and after is the same question a project file would
 * ask. The device's own store is compared separately, and must never move.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { deviceStorageSnapshot } from "@/lib/acceptance/device-storage";
import { readFixture } from "@/lib/acceptance/fixture-read";
import { judgeWrite, type WriteEvidence, type WriteVerdict } from "@/lib/acceptance/evidence";
import {
  emptyTransportLog,
  observeTransport,
  type TransportLog,
  type TransportSample,
  type TransportStatus,
} from "@/lib/acceptance/transitions";
import { LISTEN_KEYS, type AcceptanceAuto, type ListenKey } from "@/lib/acceptance/report";
import type { MemoryStorage } from "@/lib/acceptance/memory-storage";

/** Where each technique sits, in ticks from the song's start. */
export type ListenWindow = { readonly from: number; readonly to: number };

type Debug = {
  status: () => string;
  ticks: () => number;
  bpm: () => number;
  position: () => { barKey: string | null; barIndex: number; slotIndex: number };
  loop: () => { on: boolean; startTicks: number; endTicks: number } | null;
};

const readDebug = (): Debug | null =>
  (typeof window === "undefined"
    ? null
    : ((window as unknown as { __aranjeDebug?: Debug }).__aranjeDebug ?? null));

const STATUSES: readonly TransportStatus[] = [
  "idle",
  "loading",
  "playing",
  "paused",
  "ended",
  "error",
];

const statusOf = (raw: string): TransportStatus =>
  STATUSES.find((known) => known === raw) ?? "idle";

const EMPTY_HEARD = Object.fromEntries(
  LISTEN_KEYS.map((key) => [key, false]),
) as Record<ListenKey, boolean>;

const undoOffered = (): boolean => {
  const node = document.querySelector("[data-undo]");
  return node !== null && !node.hasAttribute("disabled");
};

export function useAcceptanceWatch(
  windows: Readonly<Record<ListenKey, ListenWindow>>,
  storage: MemoryStorage,
): {
  readonly observed: AcceptanceAuto;
  readonly loadingText: string;
  readonly loadMs: number | null;
  readonly firstSoundMs: number | null;
  markFirstTap(): void;
  /** Take the "before" picture for the ghost step. */
  openGhostWindow(): void;
} {
  const before = useRef<string | null>(null);
  const firstTap = useRef<number | null>(null);
  const ghostStart = useRef<WriteEvidence | null>(null);
  const previousSample = useRef<TransportSample | null>(null);
  /*
   * The log is folded here, in the tick, and not inside the state updater.
   *
   * React runs an updater when it renders, which is after the tick that
   * queued it has already advanced `previousSample` — so a fold written
   * inside the updater compared every sample with itself, and no transition
   * ever had a "before". The seek was the visible casualty: the playhead
   * really did move to the second bar and the log said it never happened.
   */
  const log = useRef<TransportLog>(emptyTransportLog());
  const store = useRef(storage);

  const [observed, setObserved] = useState<AcceptanceAuto>(() => ({
    selectionOpened: false,
    moreSheetOpened: false,
    selectionCancelled: false,
    ghostVoices: 0,
    ghostWrite: { kind: "nothing_written" } as WriteVerdict,
    transport: emptyTransportLog(),
    stuckLoading: false,
    errors: [],
    heard: { ...EMPTY_HEARD },
    storageUnchanged: true,
  }));
  const [loadingText, setLoadingText] = useState("");
  const [timing, setTiming] = useState<{
    readonly loadMs: number | null;
    readonly firstSoundMs: number | null;
  }>({ loadMs: null, firstSoundMs: null });

  useEffect(() => {
    store.current = storage;
  });

  useEffect(() => {
    before.current ??= deviceStorageSnapshot();

    const errors: string[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      errors.push(String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    let loadingSince: number | null = null;
    let everLoaded = false;

    const tick = () => {
      const debug = readDebug();
      const status = statusOf(debug?.status() ?? "idle");
      const at = debug?.position();
      const loop = debug?.loop();
      const ticks = debug?.ticks() ?? 0;

      const statusNode = document.querySelector("[data-transport-status]");
      setLoadingText(statusNode?.textContent?.trim() ?? "");

      if (status === "loading") {
        loadingSince ??= performance.now();
        everLoaded = true;
      } else {
        loadingSince = null;
      }

      const since = firstTap.current;
      if (since !== null) {
        setTiming((current) => ({
          loadMs:
            current.loadMs ??
            (everLoaded && status !== "loading" && status !== "idle"
              ? performance.now() - since
              : null),
          firstSoundMs:
            current.firstSoundMs ??
            (status === "playing" ? performance.now() - since : null),
        }));
      }

      /*
       * The practice speed comes from the pill's own accessible name, which
       * is built from the settings the transport is actually running at — not
       * from a class, which could be styled without the engine agreeing.
       */
      const pill = document.querySelector("[aria-label^='Çalışma hızı yüzde']");
      const percent = Number(
        /yüzde (\d+)/.exec(pill?.getAttribute("aria-label") ?? "")?.[1] ?? 100,
      );

      const sample: TransportSample = {
        status,
        ticks,
        barIndex: at?.barIndex ?? 0,
        loopOn: loop?.on ?? false,
        percent,
        offersPlay:
          document.querySelector("[aria-label='Çal']") !== null &&
          document.querySelector("[aria-label='Duraklat']") === null,
      };

      log.current = observeTransport(log.current, sample, previousSample.current);
      previousSample.current = sample;
      const transport = log.current;

      const ghost = Number(
        document.querySelector("[data-pen-ghost]")?.getAttribute("data-pen-ghost") ?? 0,
      );
      const fixture = readFixture(store.current);

      setObserved((previous) => {
        const heard = { ...previous.heard };
        if (status === "playing") {
          for (const key of LISTEN_KEYS) {
            const window_ = windows[key];
            if (ticks >= window_.from && ticks <= window_.to) heard[key] = true;
          }
        }

        const opened = ghostStart.current;
        const ghostWrite: WriteVerdict =
          opened === null
            ? previous.ghostWrite
            : judgeWrite({
                ...opened,
                songAfter: fixture.song,
                notesAfter: fixture.notes,
                storageWrites: Math.max(0, fixture.revision - opened.historyDepthBefore),
                historyDepthAfter: fixture.revision,
                undoOfferedAfter: undoOffered(),
              });

        return {
          ...previous,
          selectionOpened:
            previous.selectionOpened ||
            document.querySelector("[data-selection-toolbar]") !== null,
          moreSheetOpened:
            previous.moreSheetOpened ||
            document.querySelector("[data-selection-action='Kopyala']") !== null,
          selectionCancelled:
            previous.selectionCancelled ||
            (previous.selectionOpened &&
              document.querySelector("[data-selection-toolbar]") === null),
          ghostVoices: Math.max(previous.ghostVoices, ghost),
          ghostWrite,
          transport,
          stuckLoading:
            previous.stuckLoading ||
            (loadingSince !== null && performance.now() - loadingSince > 20_000),
          errors: errors.slice(0, 8),
          heard,
          storageUnchanged: before.current === deviceStorageSnapshot(),
        };
      });
    };

    /*
     * Fast enough that a transition is unlikely to fall between two samples,
     * and cheap because every read is a getter or a `querySelector`. The log
     * itself no longer depends on the rate — this only narrows the window.
     */
    const timer = window.setInterval(tick, 100);
    tick();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [windows]);

  /*
   * Both handles are stable, and that is load-bearing rather than tidy. This
   * hook re-renders ten times a second, so a callback rebuilt each render
   * would change the identity of anything that depends on it — and the caller
   * depends on `openGhostWindow` to decide when a guided step is entered. The
   * first version was not stable, and the effect it fed re-entered the step on
   * every tick: the workspace was put back into its starting state ten times a
   * second, and no selection the reader made survived long enough to be seen.
   */
  const markFirstTap = useCallback(() => {
    firstTap.current ??= performance.now();
  }, []);

  const openGhostWindow = useCallback(() => {
    const fixture = readFixture(store.current);
    ghostStart.current = {
      songBefore: fixture.song,
      songAfter: fixture.song,
      notesBefore: fixture.notes,
      notesAfter: fixture.notes,
      storageWrites: 0,
      historyDepthBefore: fixture.revision,
      historyDepthAfter: fixture.revision,
      undoOfferedAfter: false,
    };
  }, []);

  return {
    observed,
    loadingText,
    loadMs: timing.loadMs,
    firstSoundMs: timing.firstSoundMs,
    markFirstTap,
    openGhostWindow,
  };
}

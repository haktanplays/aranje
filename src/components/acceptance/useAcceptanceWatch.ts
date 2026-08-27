"use client";

/**
 * What the page notices while the reader works (K-59.1 §5).
 *
 * Nobody is asked to read a log or name a coordinate. The transport is read
 * through the same `?debug=1` handle every browser harness uses — which is
 * **read only**, by design: this watches, it never drives. Everything else is
 * the DOM the workspace already publishes.
 *
 * The storage proof is the important one. A snapshot of `localStorage` is
 * taken before the fixture mounts and compared byte for byte at the end: if a
 * guided test on a fixed riff can change the reader's own music, that is the
 * finding, and it is not one a person could be expected to spot.
 */
import { useEffect, useRef, useState } from "react";

import { LISTEN_KEYS, type AcceptanceAuto, type ListenKey } from "@/lib/acceptance/report";

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

const snapshotStorage = (): string => {
  if (typeof window === "undefined") return "";
  try {
    const store = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null) keys.push(key);
    }
    keys.sort();
    return JSON.stringify(keys.map((key) => [key, store.getItem(key)]));
  } catch {
    // A browser that refuses storage cannot have had it changed either.
    return "unavailable";
  }
};

const EMPTY_HEARD = Object.fromEntries(
  LISTEN_KEYS.map((key) => [key, false]),
) as Record<ListenKey, boolean>;

export function useAcceptanceWatch(windows: Readonly<Record<ListenKey, ListenWindow>>): {
  readonly observed: AcceptanceAuto;
  readonly loadingText: string;
  /** Milliseconds from the reader's first tap, or null while it has not happened. */
  readonly loadMs: number | null;
  readonly firstSoundMs: number | null;
  markFirstTap(): void;
} {
  const before = useRef<string | null>(null);
  const firstTap = useRef<number | null>(null);
  const [observed, setObserved] = useState<AcceptanceAuto>(() => ({
    selectionOpened: false,
    moreSheetOpened: false,
    selectionCancelled: false,
    ghostVoices: 0,
    ghostWroteNothing: true,
    played: false,
    paused: false,
    resumed: false,
    seekedBarIndex: null,
    loopSeen: false,
    tempoChanged: false,
    transportDesync: false,
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
    before.current ??= snapshotStorage();

    const errors: string[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      errors.push(String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    /* What the previous tick saw, so a transition can be told from a state. */
    let wasPlaying = false;
    let sawPause = false;
    let baseBpm: number | null = null;
    let loadingSince: number | null = null;
    let digitsBefore = -1;
    /* Three consecutive ticks of disagreement, so a transition is not one. */
    let desyncTicks = 0;
    let everLoaded = false;

    const tick = () => {
      const debug = readDebug();
      const status = debug?.status() ?? "idle";
      const bpm = debug?.bpm() ?? 0;
      const at = debug?.position();
      const loop = debug?.loop();

      const statusNode = document.querySelector("[data-transport-status]");
      setLoadingText(statusNode?.textContent?.trim() ?? "");

      if (status === "loading") {
        loadingSince ??= performance.now();
        everLoaded = true;
      } else {
        loadingSince = null;
      }

      /*
       * Two timings, both measured from the reader's own first tap and both
       * null until the thing actually happened. Nothing here is estimated: a
       * run where the sounds never finished loading reports a dash, not a
       * number that would read like a result.
       */
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
       * The play control still offering to play while the engine says it is
       * playing. Read from the button's own accessible name, because that is
       * what the reader is looking at.
       */
      const offersPlay =
        document.querySelector("[aria-label='Çal']") !== null &&
        document.querySelector("[aria-label='Duraklat']") === null;
      desyncTicks = status === "playing" && offersPlay ? desyncTicks + 1 : 0;

      // Real fret numbers, ghosts excluded: a preview is not music.
      const digits = [...document.querySelectorAll("[data-fret-glyph]")].filter(
        (node) => !node.closest("[data-pen-ghost]"),
      ).length;
      if (digitsBefore < 0) digitsBefore = digits;

      const ghost = Number(
        document.querySelector("[data-pen-ghost]")?.getAttribute("data-pen-ghost") ?? 0,
      );

      setObserved((previous) => {
        const playing = status === "playing";
        const played = previous.played || playing;
        const paused = previous.paused || (wasPlaying && status === "paused");
        if (wasPlaying && status === "paused") sawPause = true;
        const resumed = previous.resumed || (sawPause && playing);
        if (playing && baseBpm === null) baseBpm = bpm;

        const heard = { ...previous.heard };
        const ticks = debug?.ticks() ?? 0;
        if (playing) {
          for (const key of LISTEN_KEYS) {
            const window_ = windows[key];
            if (ticks >= window_.from && ticks <= window_.to) heard[key] = true;
          }
        }

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
          // The pen previews on a press and commits on the release. A preview
          // that added a real number would show up here as one more digit.
          ghostWroteNothing: previous.ghostWroteNothing && digits <= digitsBefore,
          played,
          paused,
          resumed,
          seekedBarIndex:
            previous.seekedBarIndex ??
            (at && at.barIndex > 0 && !playing ? at.barIndex : null),
          loopSeen: previous.loopSeen || (loop?.on ?? false),
          tempoChanged:
            previous.tempoChanged || (baseBpm !== null && bpm > 0 && bpm !== baseBpm),
          stuckLoading:
            previous.stuckLoading ||
            (loadingSince !== null && performance.now() - loadingSince > 20_000),
          errors: errors.slice(0, 8),
          heard,
          transportDesync: previous.transportDesync || desyncTicks >= 3,
          storageUnchanged: before.current === snapshotStorage(),
        };
      });
      wasPlaying = status === "playing";
    };

    const timer = window.setInterval(tick, 250);
    tick();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [windows]);

  return {
    observed,
    loadingText,
    loadMs: timing.loadMs,
    firstSoundMs: timing.firstSoundMs,
    markFirstTap: () => {
      firstTap.current ??= performance.now();
    },
  };
}

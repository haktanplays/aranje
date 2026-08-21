"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { PlaybackController } from "@/lib/audio/playback";
import { DEFAULT_PRACTICE_PERCENT } from "@/lib/audio/practice-rate";
import { PreviewEngine } from "@/lib/audio/preview-engine";
import {
  createDemoClient,
  createProviderClient,
  type CoArrangerClient,
} from "@/lib/copilot/client";
import {
  copilotRequestSchema,
  type ArrangeSkill,
  type CopilotRequest,
} from "@/lib/copilot/contract";
import { buildCandidate } from "@/lib/copilot/preview";
import {
  canApply,
  initialPreviewState,
  isStale,
  previewReducer,
  type PreviewState,
} from "@/lib/copilot/preview-machine";
import { COPILOT_DEMO_ENABLED } from "@/lib/copilot/public-env";
import { lockedFor } from "@/lib/copilot/ui-options";
import type { Song } from "@/lib/song/schema";

/**
 * The screen's side of a co-arranger request.
 *
 * It owns three things and keeps them in step: the state machine, the one
 * client that was chosen at build time, and the preview's own audio engine.
 *
 * The rules that are easy to get wrong, and where they live:
 *
 * - **One engine at a time.** Starting a preview pauses the song's own
 *   playback first, and the preview engine is disposed on stop, on close, on
 *   apply, on reject and on unmount. Two graphs playing at once would be two
 *   different songs at the same time.
 * - **Nothing is written until "apply".** The candidate lives in this hook.
 *   Listening to it writes nothing anywhere.
 * - **A stale candidate cannot be applied.** The song as it was when the
 *   request was sent is kept, and compared before the write.
 */
export type CoArrangerHandle = {
  state: PreviewState;
  demo: boolean;
  open(): void;
  close(): void;
  submit(request: Omit<CopilotRequest, "lockedTrackIds" | "subjectId" | "idempotencyKey" | "song">): void;
  play(): void;
  stop(): void;
  apply(): void;
  canApplyNow: boolean;
  isStaleNow: boolean;
};

function browserFetch(
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) {
  return fetch(input, init);
}

/** A stable-enough id for one attempt. Retrying is a new attempt, not a replay. */
function newIdempotencyKey(): string {
  return `web-${crypto.randomUUID()}`;
}

/** The caller's pseudonym for the pilot: one per browser, kept locally. */
const SUBJECT_KEY = "aranje.subject";

function subjectId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(SUBJECT_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(SUBJECT_KEY, created);
    return created;
  } catch {
    return "anonymous";
  }
}

export function useCoArranger(
  song: Song,
  {
    onApply,
    onBeforePreviewPlay,
    practicePercent = DEFAULT_PRACTICE_PERCENT,
  }: {
    /**
     * The candidate, and which skill produced it.
     *
     * The skill travels with it because the edit history has to be able to
     * say what an undo would reverse (spec 13.13) — "Aranje önerisini
     * uygulama" needs to know it was an apply, and the caller cannot read it
     * off the state after this hook has cleared the request.
     */
    onApply: (candidate: Song, skill: ArrangeSkill) => void;
    /** Called before the preview engine starts, to stop the song's own. */
    onBeforePreviewPlay: () => void;
    /** The speed the song is being practised at (spec 13.8). */
    practicePercent?: number;
  },
): CoArrangerHandle {
  const [state, dispatch] = useReducer(previewReducer, initialPreviewState);

  // Chosen once, from the flag. There is no path from a failure to the other
  // client: whichever this is, it is the only one this session will use.
  const client: CoArrangerClient = useMemo(
    () => (COPILOT_DEMO_ENABLED ? createDemoClient() : createProviderClient(browserFetch)),
    [],
  );

  // One holder for the preview's engine, with the "never two at once" rule in
  // it rather than spread through the callbacks below. Built once, so a
  // re-render never replaces a live engine.
  const [engine] = useState(
    () => new PreviewEngine((candidate) => new PlaybackController(candidate)),
  );

  // The candidate is heard at the same speed as the song. The value is read
  // through a ref so a change reaches a preview that is already playing
  // without rebuilding the engine that is playing it.
  const percentRef = useRef(practicePercent);
  useEffect(() => {
    percentRef.current = practicePercent;
    engine.setPracticePercent(practicePercent);
  }, [engine, practicePercent]);

  const disposePreview = useCallback(() => {
    engine.stop();
  }, [engine]);

  // Whatever ends the preview — closing, applying, rejecting, leaving the
  // screen — the engine goes with it.
  useEffect(() => disposePreview, [disposePreview]);

  const submit = useCallback(
    (
      partial: Omit<
        CopilotRequest,
        "lockedTrackIds" | "subjectId" | "idempotencyKey" | "song"
      >,
    ) => {
      const baseline = song;
      const candidateRequest = {
        ...partial,
        lockedTrackIds: lockedFor(baseline, partial.targetTrackId),
        subjectId: subjectId(),
        idempotencyKey: newIdempotencyKey(),
        song: baseline,
      };

      const parsed = copilotRequestSchema.safeParse(candidateRequest);
      if (!parsed.success) {
        dispatch({
          type: "failed",
          error: { code: "invalid_request", message: "İstek biçimi tanınmadı." },
        });
        return;
      }
      const request = parsed.data;

      dispatch({
        type: "submit",
        request,
        baseline,
        source: client.source,
      });

      void client.arrange(request).then((outcome) => {
        if (!outcome.ok) {
          dispatch({
            type: "failed",
            error: { code: outcome.code, message: outcome.message },
          });
          return;
        }

        // The same checks the server runs, run again here (spec 11.4/6).
        const built = buildCandidate(baseline, request, outcome.patch);
        if (!built.ok) {
          dispatch({
            type: "failed",
            error: {
              code: "candidate_blocked",
              message:
                built.block.reason === "locked_surface"
                  ? "Öneri kilitli bir alanı değiştirmeye çalıştı ve durduruldu."
                  : "Öneri kontrollerden geçmedi.",
            },
          });
          return;
        }

        dispatch({
          type: "resolved",
          patch: outcome.patch,
          candidate: built.candidate,
          diff: built.diff,
          warnings: built.warnings,
        });
      });
    },
    [client, song],
  );

  const play = useCallback(() => {
    const candidate = state.candidate;
    const request = state.request;
    if (!candidate || !request) return;

    // The holder stops the song's own playback and disposes any earlier
    // preview before it builds this one.
    engine.start(
      candidate,
      request.sectionId,
      onBeforePreviewPlay,
      percentRef.current,
    );
    dispatch({ type: "play" });
  }, [engine, onBeforePreviewPlay, state.candidate, state.request]);

  const stop = useCallback(() => {
    disposePreview();
    dispatch({ type: "stop" });
  }, [disposePreview]);

  const close = useCallback(() => {
    disposePreview();
    dispatch({ type: "close" });
  }, [disposePreview]);

  const apply = useCallback(() => {
    if (!canApply(state, song) || !state.candidate || !state.request) return;
    disposePreview();
    dispatch({ type: "apply" });
    onApply(state.candidate, state.request.skill);
    dispatch({ type: "applied" });
  }, [disposePreview, onApply, song, state]);

  return {
    state,
    demo: client.source === "demo",
    open: () => dispatch({ type: "open" }),
    close,
    submit,
    play,
    stop,
    apply,
    canApplyNow: canApply(state, song),
    isStaleNow: isStale(state, song),
  };
}

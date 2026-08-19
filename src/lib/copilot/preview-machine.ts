/**
 * The states a co-arranger request passes through, as a pure reducer.
 *
 * Written as a reducer rather than a pile of `useState` calls because the
 * rules that matter are about which transitions are *not* allowed: a second
 * request while one is in flight, an apply of a candidate that no longer
 * matches the song, a preview that quietly becomes the song. Those are easy to
 * state here and easy to test without a browser.
 *
 * Spec 11.4/7: the canonical song changes only when the user accepts. This
 * machine never holds the canonical song — it holds the song as it was when
 * the request was sent, so a candidate can be compared against what the song
 * is now and refused if the ground moved.
 */
import type { CopilotErrorCode } from "@/lib/copilot/errors";
import type { CopilotPatch, CopilotRequest } from "@/lib/copilot/contract";
import { digestOf } from "@/lib/copilot/scope";
import type { DiffSummary } from "@/lib/copilot/preview";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

export type PreviewStatus =
  | "closed"
  | "editing_request"
  | "submitting"
  | "preview_ready"
  | "preview_playing"
  | "applying"
  | "error";

export type PreviewSource = "provider" | "demo";

export type PreviewError = {
  code: CopilotErrorCode | "candidate_blocked" | "stale_candidate";
  /** Safe for a musician to read. Never a provider's own words. */
  message: string;
};

export type PreviewState = {
  status: PreviewStatus;
  request: CopilotRequest | null;
  /** The song as it was when the request was sent. */
  baseline: Song | null;
  baselineDigest: string | null;
  patch: CopilotPatch | null;
  candidate: Song | null;
  diff: DiffSummary | null;
  warnings: readonly ValidationIssue[];
  error: PreviewError | null;
  source: PreviewSource | null;
};

export const initialPreviewState: PreviewState = {
  status: "closed",
  request: null,
  baseline: null,
  baselineDigest: null,
  patch: null,
  candidate: null,
  diff: null,
  warnings: [],
  error: null,
  source: null,
};

export type PreviewEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "submit"; request: CopilotRequest; baseline: Song; source: PreviewSource }
  | {
      type: "resolved";
      patch: CopilotPatch;
      candidate: Song;
      diff: DiffSummary;
      warnings: readonly ValidationIssue[];
    }
  | { type: "failed"; error: PreviewError }
  | { type: "play" }
  | { type: "stop" }
  | { type: "apply" }
  | { type: "applied" };

/** True while a request is in flight or a candidate is being written. */
export function isBusy(state: PreviewState): boolean {
  return state.status === "submitting" || state.status === "applying";
}

/** The song moved under us since the request was sent (spec 11.4/7). */
export function isStale(state: PreviewState, currentSong: Song): boolean {
  if (state.baselineDigest === null) return false;
  return state.baselineDigest !== digestOf(currentSong);
}

/** A candidate may only be written when it is ready and still current. */
export function canApply(state: PreviewState, currentSong: Song): boolean {
  if (state.candidate === null) return false;
  if (state.status !== "preview_ready" && state.status !== "preview_playing") {
    return false;
  }
  return !isStale(state, currentSong);
}

export function previewReducer(
  state: PreviewState,
  event: PreviewEvent,
): PreviewState {
  switch (event.type) {
    case "open":
      // A request in flight is not interrupted by opening the sheet again.
      if (isBusy(state)) return state;
      if (state.status === "preview_ready" || state.status === "preview_playing") {
        return state;
      }
      return { ...initialPreviewState, status: "editing_request" };

    case "close":
      // Closing throws the candidate away. It was never the song.
      if (state.status === "applying") return state;
      return initialPreviewState;

    case "submit": {
      // One request at a time, and none at all while a preview is open.
      if (state.status !== "editing_request" && state.status !== "error") {
        return state;
      }
      return {
        ...initialPreviewState,
        status: "submitting",
        request: event.request,
        baseline: event.baseline,
        baselineDigest: digestOf(event.baseline),
        source: event.source,
      };
    }

    case "resolved":
      if (state.status !== "submitting") return state;
      return {
        ...state,
        status: "preview_ready",
        patch: event.patch,
        candidate: event.candidate,
        diff: event.diff,
        warnings: event.warnings,
        error: null,
      };

    case "failed":
      if (state.status !== "submitting" && state.status !== "applying") {
        return state;
      }
      return {
        ...state,
        status: "error",
        patch: null,
        candidate: null,
        diff: null,
        warnings: [],
        error: event.error,
      };

    case "play":
      if (state.status !== "preview_ready") return state;
      return { ...state, status: "preview_playing" };

    case "stop":
      if (state.status !== "preview_playing") return state;
      return { ...state, status: "preview_ready" };

    case "apply":
      if (state.status !== "preview_ready" && state.status !== "preview_playing") {
        return state;
      }
      if (state.candidate === null) return state;
      return { ...state, status: "applying" };

    case "applied":
      if (state.status !== "applying") return state;
      return initialPreviewState;
  }
}

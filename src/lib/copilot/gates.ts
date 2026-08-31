import type { PreviewStatus } from "@/lib/copilot/preview-machine";

/**
 * Which door the Copilot is currently holding open.
 *
 * Two questions the workspace asks about the same status: is the preview on
 * screen (so editing must stand back), and is the request sheet on screen (so
 * the notation surface is not the thing being touched). Both are pure reads of
 * one status, so they belong here rather than inline in the composition root.
 */
export type CopilotGates = {
  /** A candidate is on screen — ready, playing or being applied. */
  readonly previewOpen: boolean;
  /** The request sheet is on screen — being written, sent, or refused. */
  readonly arrangeOpen: boolean;
};

const PREVIEW: readonly PreviewStatus[] = ["preview_ready", "preview_playing", "applying"];
const ARRANGE: readonly PreviewStatus[] = ["editing_request", "submitting", "error"];

export function copilotGates(status: PreviewStatus): CopilotGates {
  return { previewOpen: PREVIEW.includes(status), arrangeOpen: ARRANGE.includes(status) };
}

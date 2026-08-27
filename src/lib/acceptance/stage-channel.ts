/**
 * Which guided step the workspace should be standing in (K-59.1 §3, §4).
 *
 * A module channel rather than a prop threaded through the composition root,
 * for the same reason the project session is one: the guided route and the
 * workspace are two different trees mounted by the same page, and the thing
 * they have to agree about is a single value with a single writer.
 *
 * It is also the shape that keeps this out of the product's way. On every
 * ordinary route nothing ever calls `setStage`, the channel stays `null`, and
 * the workspace behaves exactly as it always has — there is no branch in the
 * product that says "if this is the acceptance run".
 *
 * Nothing here reaches the Song. A stage is view state: which surface is
 * showing, whether the editor is open, which tool is held, where the playhead
 * is. Applying one produces no command, no history step and no storage write.
 */
import type { WorkspaceStage } from "@/lib/workspace/workspace-stage";

let stage: WorkspaceStage | null = null;
const listeners = new Set<() => void>();

export function getStage(): WorkspaceStage | null {
  return stage;
}

/** Null on the server, so hydration sees what the server rendered. */
export function serverStage(): WorkspaceStage | null {
  return null;
}

export function subscribeStage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Enter a step.
 *
 * `entry` counts entries rather than naming them, so stepping back to a step
 * the reader has already been through applies it again — which is the point:
 * the step's job is to guarantee a state, not to remember having done so.
 */
export function setStage(name: WorkspaceStage["name"]): void {
  stage = { name, entry: (stage?.entry ?? 0) + 1 };
  for (const listener of listeners) listener();
}

/** Put the channel back, so a second run in one process starts clean. */
export function clearStage(): void {
  stage = null;
  for (const listener of listeners) listener();
}

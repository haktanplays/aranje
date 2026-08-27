/**
 * The state a guided step needs before the reader is asked to do anything
 * (K-59.1 §3, §4).
 *
 * The live acceptance run failed on this before it failed on anything else.
 * The route opened on "Düzen", so step 2 asked the reader to check a tab that
 * was not on screen. Then step 4 left an empty selection and edit mode
 * behind, so step 5 — "now press play" — started from a workspace that was
 * still mid-edit. Every later measurement was taken in a state the script had
 * not asked for.
 *
 * A step therefore says what it *needs*, once, and the workspace is put into
 * that state when the step is entered. Two properties make this safe to point
 * at the real workspace:
 *
 * - **It is a plan, not a command.** Everything here is a view-state fact:
 *   which surface is showing, whether edit mode is open, which tool is held,
 *   where the playhead is. Nothing in it can reach the Song.
 * - **It cannot write.** Applying a stage calls no command, produces no
 *   history step and stores nothing (spec 13.13). A guided test that left an
 *   undo step behind would be a test that changed the thing it measured.
 */
export type StageName = "read" | "select" | "ghost" | "play";

/** A stage and the number of times it has been entered. */
export type WorkspaceStage = {
  readonly name: StageName;
  /** Bumped on every entry, so re-entering a step re-applies it. */
  readonly entry: number;
};

export type StagePlan = {
  /** Always the tab: every guided step is about the notes. */
  readonly showTab: true;
  readonly editing: boolean;
  /** The tool to hold, or null to put everything down. */
  readonly pen: "power_chord_3" | null;
  /** Selections, drawers and staged commands are cleared on every entry. */
  readonly clearSelection: true;
  readonly closeSheets: true;
  /** Only the listening step needs the transport put back to the beginning. */
  readonly resetTransport: boolean;
};

export function stagePlan(name: StageName): StagePlan {
  return {
    showTab: true,
    editing: name === "select" || name === "ghost",
    pen: name === "ghost" ? "power_chord_3" : null,
    clearSelection: true,
    closeSheets: true,
    resetTransport: name === "play",
  };
}

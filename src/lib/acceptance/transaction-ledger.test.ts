import { describe, expect, it } from "vitest";

import {
  LEDGER_INVARIANTS,
  judgeActionLedger,
  type TransactionPoint,
} from "@/lib/acceptance/transaction-ledger";

const point = (
  songBytes: string,
  revision: number,
  historyLength: number,
  evalSongWrites: number,
  commandCount: number,
  mutatingCommandCount = commandCount,
): TransactionPoint => ({
  songBytes,
  songHash: `hash:${songBytes}`,
  revision,
  historyLength,
  undoDepth: Math.max(0, historyLength - 1),
  redoDepth: 0,
  evalSongWrites,
  commandCount,
  mutatingCommandCount,
});

describe("selection transaction ledger", () => {
  const before = point("A", 1, 1, 0, 0, 0);
  const after = point("B", 2, 2, 1, 1, 1);
  const undone = point("A", 3, 2, 2, 2, 1);
  const redone = point("B", 4, 2, 3, 3, 1);
  const cleanup = point("A", 1, 1, 3, 3, 1);

  it("names one atomic write and byte-exact undo/redo", () => {
    const ledger = judgeActionLedger({
      action: "paste",
      before,
      after,
      undo: undone,
      redo: redone,
      cleanup,
      semantic: { [LEDGER_INVARIANTS.clipboardAttached]: true },
    });
    expect(ledger.result).toBe("atomic");
    expect(ledger.failures).toEqual([]);
    expect(ledger).toMatchObject({
      revisionDelta: 1,
      commandCount: 1,
      mutatingCommandCount: 1,
      storageWriteCount: 1,
      undoHash: "hash:A",
      redoHash: "hash:B",
      cleanupHash: "hash:A",
    });
  });

  it("keeps copy read-only while still requiring one production command", () => {
    /*
     * One event, zero mutating commands. This is the pair the two counters
     * exist for: a copy that published nothing would be unmeasurable, and a
     * copy that committed would be a defect.
     */
    const copied = point("A", 1, 1, 0, 1, 0);
    const ledger = judgeActionLedger({
      action: "copy",
      before,
      after: copied,
      cleanup: copied,
    });
    expect(ledger.result).toBe("read_only");
    expect(ledger.commandCount).toBe(1);
    expect(ledger.mutatingCommandCount).toBe(0);
    expect(ledger.failures).toEqual([]);
  });

  it("catches a copy that quietly committed", () => {
    const wrote = point("B", 2, 2, 1, 1, 1);
    const ledger = judgeActionLedger({
      action: "copy",
      before,
      after: wrote,
      cleanup: before,
    });
    expect(ledger.result).toBe("failed");
    expect(ledger.failures).toEqual(
      expect.arrayContaining([
        "copy_mutating_commands_expected_0_received_1",
        "copy_changed_song",
        "copy_storage_writes_expected_0_received_1",
        "copy_revision_delta_expected_0_received_1",
        "copy_history_delta_expected_0_received_1",
      ]),
    );
  });

  it("does not collapse several broken invariants into one KALDI", () => {
    const halfMoved = point("C", 3, 3, 2, 1, 2);
    const ledger = judgeActionLedger({
      action: "move",
      before,
      after: halfMoved,
      cleanup: halfMoved,
      semantic: {
        [LEDGER_INVARIANTS.halfMoved]: false,
        [LEDGER_INVARIANTS.lostTie]: false,
      },
    });
    expect(ledger.result).toBe("failed");
    /* Each one names the invariant and, where there is a number, both sides
       of it — so the report can be acted on without re-deriving anything. */
    expect(ledger.failures).toEqual(
      expect.arrayContaining([
        "mutating_command_expected_1_received_2",
        "storage_writes_expected_1_received_2",
        "revision_delta_expected_1_received_2",
        "history_delta_expected_1_received_2",
        "undo_checkpoint_missing",
        "redo_checkpoint_missing",
        "cleanup_hash_mismatch",
        "move_exposed_partial_song",
        "repeat_lost_tie",
      ]),
    );
    expect(ledger.failures.some((name) => name === "KALDI")).toBe(false);
  });

  it("names an undo that came back to different bytes", () => {
    const ledger = judgeActionLedger({
      action: "delete",
      before,
      after,
      undo: point("A-different", 3, 2, 2, 2, 1),
      redo: redone,
      cleanup,
    });
    expect(ledger.failures).toContain("undo_hash_mismatch");
  });

  it("names a redo that did not put back what undo took", () => {
    const ledger = judgeActionLedger({
      action: "duplicate",
      before,
      after,
      undo: undone,
      redo: point("B-different", 4, 2, 3, 3, 1),
      cleanup,
    });
    expect(ledger.failures).toContain("redo_hash_mismatch");
  });

  it("names two history steps where one edit was made", () => {
    const twoSteps = point("B", 2, 3, 1, 1, 1);
    const ledger = judgeActionLedger({
      action: "paste",
      before,
      after: twoSteps,
      undo: undone,
      redo: point("B", 4, 3, 3, 3, 1),
      cleanup,
    });
    expect(ledger.failures).toContain("history_delta_expected_1_received_2");
  });

  it("requires a typed refusal to leave every mutation channel untouched", () => {
    const refused = point("A", 1, 1, 0, 1, 0);
    const ledger = judgeActionLedger({
      action: "repeat",
      before,
      after: refused,
      cleanup: refused,
      refusal: true,
    });
    expect(ledger.result).toBe("refused");
    expect(ledger.failures).toEqual([]);
  });

  it("names a refusal that wrote anyway", () => {
    const leaked = point("B", 2, 2, 1, 1, 1);
    const ledger = judgeActionLedger({
      action: "repeat",
      before,
      after: leaked,
      cleanup: leaked,
      refusal: true,
    });
    expect(ledger.failures).toEqual(
      expect.arrayContaining([
        "refusal_changed_song",
        "refusal_wrote_storage_1",
        "refusal_moved_revision_1",
        "refusal_added_history_step_1",
      ]),
    );
  });

  it("names a step the founder never reached", () => {
    /* Nothing happened at all: no event, no write, no revision. The old
       ledger would have called this "no change"; it is "no command". */
    const ledger = judgeActionLedger({
      action: "delete",
      before,
      after: before,
      cleanup: before,
    });
    expect(ledger.failures).toContain("command_count_expected_1_received_0");
    expect(ledger.failures).toContain("song_hash_unchanged");
  });
});

import { describe, expect, it } from "vitest";

import {
  judgeActionLedger,
  type TransactionPoint,
} from "@/lib/acceptance/transaction-ledger";

const point = (
  songBytes: string,
  revision: number,
  historyLength: number,
  evalSongWrites: number,
  commandCount: number,
): TransactionPoint => ({
  songBytes,
  songHash: `hash:${songBytes}`,
  revision,
  historyLength,
  undoDepth: Math.max(0, historyLength - 1),
  redoDepth: 0,
  evalSongWrites,
  commandCount,
});

describe("selection transaction ledger", () => {
  const before = point("A", 1, 1, 0, 0);
  const after = point("B", 2, 2, 1, 1);
  const undone = point("A", 3, 2, 2, 2);
  const redone = point("B", 4, 2, 3, 3);
  const cleanup = point("A", 1, 1, 3, 3);

  it("names one atomic write and byte-exact undo/redo", () => {
    const ledger = judgeActionLedger({
      action: "paste",
      before,
      after,
      undo: undone,
      redo: redone,
      cleanup,
      semantic: { clipboardDetached: true },
    });
    expect(ledger.result).toBe("atomic");
    expect(ledger.failures).toEqual([]);
    expect(ledger).toMatchObject({
      revisionDelta: 1,
      commandCount: 1,
      storageWriteCount: 1,
      undoHash: "hash:A",
      redoHash: "hash:B",
      cleanupHash: "hash:A",
    });
  });

  it("keeps copy read-only while still requiring one production command", () => {
    const copied = point("A", 1, 1, 0, 1);
    expect(
      judgeActionLedger({
        action: "copy",
        before,
        after: copied,
        cleanup: copied,
      }).result,
    ).toBe("read_only");
  });

  it("does not collapse several broken invariants into one KALDI", () => {
    const halfMoved = point("C", 3, 3, 2, 1);
    const ledger = judgeActionLedger({
      action: "move",
      before,
      after: halfMoved,
      cleanup: halfMoved,
      semantic: { noHalfMovedSong: false, keptTechniques: false },
    });
    expect(ledger.result).toBe("failed");
    expect(ledger.failures).toEqual(
      expect.arrayContaining([
        "storageWrites=2, expected=1",
        "revisionDelta=2, expected=1",
        "historyDelta=2, expected=1",
        "undo checkpoint missing",
        "redo checkpoint missing",
        "cleanup hash differs",
        "semantic:noHalfMovedSong",
        "semantic:keptTechniques",
      ]),
    );
  });

  it("requires a typed refusal to leave every mutation channel untouched", () => {
    const refused = point("A", 1, 1, 0, 1);
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
});

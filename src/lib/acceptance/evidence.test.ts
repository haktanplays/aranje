import { describe, expect, it } from "vitest";

import { judgeWrite, writeLine, type WriteEvidence } from "@/lib/acceptance/evidence";

const CLEAN: WriteEvidence = {
  songBefore: "{a}",
  songAfter: "{a}",
  notesBefore: 24,
  notesAfter: 24,
  storageWrites: 0,
  historyDepthBefore: 0,
  historyDepthAfter: 0,
  undoOfferedAfter: false,
};

describe("judgeWrite", () => {
  it("says nothing was written only when every source agrees", () => {
    expect(judgeWrite(CLEAN)).toEqual({ kind: "nothing_written" });
  });

  it("says something was written when the song, storage and history agree", () => {
    expect(
      judgeWrite({
        ...CLEAN,
        songAfter: "{b}",
        notesAfter: 27,
        storageWrites: 1,
        historyDepthAfter: 1,
        undoOfferedAfter: true,
      }),
    ).toEqual({ kind: "written", notesAdded: 3 });
  });

  /*
   * The exact contradiction the live run printed. It is not "yazma VAR" and
   * it is not "none": it is the two of them disagreeing, which is a third
   * thing and a more serious one.
   */
  it("calls a song change with no storage and no history what it is", () => {
    const verdict = judgeWrite({ ...CLEAN, songAfter: "{b}", notesAfter: 27 });
    expect(verdict.kind).toBe("inconsistent");
    expect(writeLine(verdict)).toMatch(/TUTARSIZ/);
  });

  it("calls a history step behind an unchanged song inconsistent too", () => {
    expect(judgeWrite({ ...CLEAN, historyDepthAfter: 1, storageWrites: 1 }).kind).toBe(
      "inconsistent",
    );
  });

  it("calls an undo offered over an unchanged song inconsistent", () => {
    expect(judgeWrite({ ...CLEAN, undoOfferedAfter: true }).kind).toBe("inconsistent");
  });

  /*
   * The measurement bug itself: on screen there were more numbers, because a
   * preview draws numbers. None of the five sources moved, so nothing was
   * written — whatever the screen looked like.
   */
  it("is unmoved by anything that only changed the screen", () => {
    expect(judgeWrite(CLEAN)).toEqual({ kind: "nothing_written" });
    expect(writeLine(judgeWrite(CLEAN))).toBe("yazma yok");
  });

  it("reports how many notes a real write added", () => {
    const verdict = judgeWrite({
      ...CLEAN,
      songAfter: "{b}",
      notesAfter: 27,
      storageWrites: 1,
      historyDepthAfter: 1,
      undoOfferedAfter: true,
    });
    expect(writeLine(verdict)).toBe("yazma VAR (3 nota)");
  });
});

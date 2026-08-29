import { describe, expect, it } from "vitest";

import { barMoreDoorShown, barMoreEntries } from "@/lib/song/bar-menu";

/**
 * The founder's empty dialog, as a test (2U-B §6).
 *
 * Holding one instrument's bar with nothing on the clipboard used to open a
 * titled sheet with no contents at all. These are the two halves of the rule
 * that replaced it: what is behind the door, and whether the door is drawn.
 */
describe("what is behind a bar selection's «Daha fazla»", () => {
  const SCOPES = ["track", "full"] as const;

  it("never opens a door onto nothing", () => {
    for (const scope of SCOPES) {
      for (const canPaste of [false, true]) {
        const shown = barMoreDoorShown(scope, canPaste);
        const entries = barMoreEntries(scope, canPaste);
        expect(shown, `${scope}/${canPaste}`).toBe(entries.length > 0);
      }
    }
  });

  it("hides the door on the case that was empty", () => {
    /* One instrument's bar, empty clipboard: the founder's exact state. */
    expect(barMoreEntries("track", false)).toEqual([]);
    expect(barMoreDoorShown("track", false)).toBe(false);
  });

  it("offers a track selection its paste and nothing structural", () => {
    const actions = barMoreEntries("track", true).map((entry) => entry.action);
    expect(actions).toContain("paste");
    /*
     * Adding or removing a bar for one instrument would leave the section a
     * different length on that track than on every other, which is not a
     * longer song but two songs. `selection-capability.ts` refuses the same
     * verbs in the same scope, and these two must not drift apart.
     */
    expect(actions).not.toContain("blank_before");
    expect(actions).not.toContain("blank_after");
    expect(actions).not.toContain("timing");
  });

  it("offers a whole measure the structural verbs, with or without a clipboard", () => {
    const withoutClipboard = barMoreEntries("full", false).map((e) => e.action);
    expect(withoutClipboard).toEqual([
      "timing",
      "blank_before",
      "blank_after",
    ]);
    const withClipboard = barMoreEntries("full", true).map((e) => e.action);
    expect(withClipboard).toContain("paste");
    expect(withClipboard).toContain("insert_before");
    expect(withClipboard).toContain("insert_after");
  });

  it("never offers the same action twice", () => {
    for (const scope of SCOPES) {
      for (const canPaste of [false, true]) {
        const actions = barMoreEntries(scope, canPaste).map((e) => e.action);
        expect(new Set(actions).size, `${scope}/${canPaste}`).toBe(actions.length);
      }
    }
  });

  it("gives every entry a label a reader can act on", () => {
    for (const scope of SCOPES) {
      for (const entry of barMoreEntries(scope, true)) {
        expect(entry.label.trim().length, entry.action).toBeGreaterThan(3);
      }
    }
  });
});

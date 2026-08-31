/**
 * The listening harness may not promise what it did not measure (2V-A §10).
 *
 * Three ways this round could lie about itself, all in prose or in the shape
 * of a step rather than in behaviour:
 *
 * - calling a desktop Chromium run a physical pass;
 * - asserting a scroll position without saying which element it read, which
 *   is exactly how 2U-C's harness reported 108/108 on a gesture the founder
 *   could not make;
 * - reporting a zero from an instrument that could not have shown anything
 *   else — the whole of §6 is zeroes, and a zero is only worth the proof that
 *   the thing measuring it can move.
 *
 * And one about the sound itself: this round proves that the right notes were
 * scheduled in the right window. Nobody has listened to it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

/** Source with its comments taken out — the rule is about what it *emits*. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const harness = read("eval/editor-2va/verify.mjs");

describe("the harness says what kind of evidence it produces", () => {
  it("labels its own results as an emulation", () => {
    expect(harness).toContain('kind: "browser emulation — not a physical device"');
  });

  it("never calls a run of itself a physical pass", () => {
    expect(code(harness).toLowerCase()).not.toContain("physical pass");
  });

  it("says so again where the total is printed", () => {
    expect(harness).toMatch(/browser emulation, not a physical device/);
  });

  it("makes no claim about how any of it sounded", () => {
    const lowered = code(harness).toLowerCase();
    for (const word of ["organic", "musical", "sounds better", "tone quality"]) {
      expect(lowered, word).not.toContain(word);
    }
  });
});

describe("every step names the surface it reads", () => {
  it("stops the scroll walk at the workspace rather than the guided page", () => {
    /*
     * The acceptance chrome scrolls its own step list, and a walk that ran
     * past the workspace root would be reporting the page's furniture as the
     * app's background — which is the 2U-C failure with a different element.
     */
    expect(harness).toContain("if (node.clientHeight >= window.innerHeight) break;");
  });

  it("proves the scroll reading can see the surface move", () => {
    expect(harness).toContain("so the instrument moves");
  });

  it("reads the selection's own bounds rather than guessing from the screen", () => {
    expect(harness).toContain("d.selection()");
  });
});

describe("the zeroes are proved rather than asserted", () => {
  it("keeps a step whose whole job is to make the instruments move", () => {
    expect(harness).toContain("and the same instruments would have seen a real edit");
  });

  it("makes that step require all three readings to change", () => {
    const step = harness.slice(harness.indexOf("would have seen a real edit"));
    expect(step).toContain("edited.bytes !== page.__before.bytes");
    expect(step).toContain("edited.revision > page.__before.revision");
    expect(step).toContain("undoAfter?.disabled === false");
  });

  it("does not count writes with a wrapper the route would never trip", () => {
    /*
     * This page's storage is a `Map` it owns, so a `localStorage.setItem`
     * counter reads zero whatever the app does. The revision is the app's own
     * number and moves once per committed edit.
     */
    expect(code(harness)).not.toContain("Storage.prototype.setItem");
  });
});

describe("what the round does not claim", () => {
  it("starts playback only from the control a reader presses", () => {
    /* No test-only playback button, and no reaching past the UI to start a
       run: the debug handle is read from and never called into. */
    const emitted = code(harness);
    expect(emitted).not.toMatch(/playSelection|stopSelection|controller\./);
    expect(emitted).toContain('drawerAction(page, "Seçimi dinle")');
  });
});

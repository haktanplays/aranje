/**
 * The report may not promise what it did not measure (2U-C §5, §7).
 *
 * Two claims in this round are worth exactly as much as their honesty. The
 * harness runs Chromium with an Android user-agent string and CDP touch
 * events; that is a browser emulation, and the whole defect it is checking
 * lived in a compositor decision that a real device makes. So a run of it can
 * never be a physical pass, and the handoff can never say the physical step
 * has been done until somebody has done it.
 *
 * These are the only tests here that guard prose rather than behaviour, and
 * they exist because prose is where this round can most easily lie.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

/** Source with its comments taken out — the rule is about what it *emits*. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the harness says what kind of evidence it produces", () => {
  const harness = read("eval/editor-2uc/verify.mjs");

  it("labels its own results as an emulation", () => {
    expect(harness).toContain(
      'kind: "browser emulation — not a physical device"',
    );
  });

  it("never calls a run of itself a physical pass", () => {
    // Of what it emits, not of what it explains: the prose above the code
    // says at length why a run of this can never be physical evidence, and a
    // rule that forbade the words would forbid saying so.
    expect(code(harness).toLowerCase()).not.toContain("physical pass");
  });

  it("says so again where the total is printed", () => {
    expect(harness).toMatch(/browser emulation, not a physical device/);
  });
});

describe("the physical handoff", () => {
  const handoff = read("eval/editor-2uc/HANDOFF.md");

  it("states that the step has not been done", () => {
    expect(handoff).toContain("Bu adım henüz yapılmadı.");
    expect(handoff).not.toContain("Bu adım yapıldı");
  });

  it("names the exact gesture the round closes on", () => {
    expect(handoff).toContain("1 → 3 → 2 ölçü");
  });

  it("asks for all five measurements §7 names", () => {
    for (const asked of [
      "Seçim 1 → 3 → 2 oldu mu",
      "arkadaki tab kaydı mı",
      "Parmağın altındaki ölçü takip edildi mi",
      "normal kaydırma çalıştı mı",
      "takılı kalan bir seçim kaldı mı",
    ]) {
      expect(handoff, asked).toContain(asked);
    }
  });

  it("sends the reader to an exact deployed SHA, not to a branch", () => {
    expect(handoff).toContain("?sha=<DEPLOY_SHA>");
    expect(handoff).toContain("`main` değil");
  });

  it("names the half of the fix a browser cannot settle", () => {
    // The bar header declares `pan-y` before the finger lands, which is a
    // promise the device honours too. The note range cannot make that promise
    // and relies on refusing each move after it owns — which is exactly what
    // questions 2 and 3 are for.
    expect(handoff).toContain("touch-action: pan-y");
    expect(handoff).toContain("2. ve 3. sorular");
  });
});

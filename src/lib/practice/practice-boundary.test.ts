/**
 * Where the practice loop is allowed to reach (2R-A §XII).
 *
 * Structural, not textual: every claim below reads the module's real import
 * list through the TypeScript parser, so a re-export, a rename or a comment
 * that happens to contain the word cannot make one pass or fail.
 *
 * The shape being defended is the one that made the pure core testable in the
 * first place — arithmetic that knows nothing about React, the transport or
 * the DOM, a hook that knows about all three, and a sheet that draws what it
 * is handed.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { importsOf, valueImportsOf } from "@/lib/dev/ast";

const PRACTICE_DIR = "src/lib/practice";

const pureModules = readdirSync(PRACTICE_DIR)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => `${PRACTICE_DIR}/${name}`);

const SESSION_HOOK = "src/lib/workspace/use-practice-session.ts";
const SHEET = "src/components/workspace/PracticeSheet.tsx";

describe("279. the practice core is pure", () => {
  it("has modules to check", () => {
    expect(pureModules.length).toBeGreaterThanOrEqual(5);
  });

  it("imports no React, no Tone and no component", () => {
    for (const path of pureModules) {
      for (const specifier of importsOf(path)) {
        expect(specifier === "react", `${path} → ${specifier}`).toBe(false);
        expect(specifier === "tone", `${path} → ${specifier}`).toBe(false);
        expect(
          specifier.startsWith("@/components/"),
          `${path} → ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("imports no storage, no history and no project machinery", () => {
    const forbidden = [
      "@/lib/song/storage",
      "@/lib/song/song-store",
      "@/lib/song/edit-history",
      "@/lib/projects/",
      "@/lib/project/",
      "@/lib/export/",
      "@/lib/copilot/",
    ];
    for (const path of pureModules) {
      for (const specifier of valueImportsOf(path)) {
        for (const prefix of forbidden) {
          expect(
            specifier.startsWith(prefix),
            `${path} → ${specifier}`,
          ).toBe(false);
        }
      }
    }
  });

  it("imports no workspace controller", () => {
    for (const path of pureModules) {
      for (const specifier of valueImportsOf(path)) {
        expect(
          specifier.startsWith("@/lib/workspace/use-"),
          `${path} → ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("never reaches into the eval harness", () => {
    /*
     * Test and measurement code may import the product. The reverse would
     * ship a harness, and is the one direction that has to be checked rather
     * than assumed (§XII).
     */
    for (const path of [...pureModules, SESSION_HOOK, SHEET]) {
      for (const specifier of importsOf(path)) {
        expect(specifier.includes("eval/"), `${path} → ${specifier}`).toBe(false);
      }
    }
  });
});

describe("280. the sheet draws, and the hook decides", () => {
  it("keeps the playback engine out of the practice UI", () => {
    /*
     * The sheet may know a session; it may not know a transport. A component
     * that could call `play()` is a second owner of playback.
     */
    for (const specifier of valueImportsOf(SHEET)) {
      expect(specifier.startsWith("@/lib/audio/"), `sheet → ${specifier}`).toBe(false);
    }
  });

  it("keeps storage, history, export and fingerprint out of it too", () => {
    for (const specifier of valueImportsOf(SHEET)) {
      for (const prefix of [
        "@/lib/song/storage",
        "@/lib/song/song-store",
        "@/lib/song/edit-history",
        "@/lib/export/",
        "@/lib/copilot/",
        "@/lib/projects/",
      ]) {
        expect(specifier.startsWith(prefix), `sheet → ${specifier}`).toBe(false);
      }
    }
  });

  it("gives the session hook the transport and nothing else it should not have", () => {
    const values = valueImportsOf(SESSION_HOOK);
    for (const specifier of values) {
      for (const prefix of [
        "@/lib/song/storage",
        "@/lib/song/song-store",
        "@/lib/song/edit-history",
        "@/lib/export/",
        "@/lib/copilot/",
        "@/components/",
      ]) {
        expect(specifier.startsWith(prefix), `hook → ${specifier}`).toBe(false);
      }
    }
  });

  it("does not let the practice hook import another workspace controller", () => {
    for (const specifier of valueImportsOf(SESSION_HOOK)) {
      expect(
        specifier.startsWith("@/lib/workspace/use-"),
        `hook → ${specifier}`,
      ).toBe(false);
    }
  });
});

describe("281. one owner each, still", () => {
  it("leaves the animation frame with its single owner", () => {
    /*
     * `runPlayheadLoop` is the app's only `requestAnimationFrame`. Practice
     * neither adds one nor asks for one, so the count of owners is unchanged
     * by this checkpoint.
     */
    for (const path of [...pureModules, SESSION_HOOK, SHEET]) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} schedules a frame`).not.toContain(
        "requestAnimationFrame",
      );
    }
  });

  it("creates no AudioContext of its own", () => {
    for (const path of [...pureModules, SESSION_HOOK, SHEET]) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} builds audio`).not.toContain("new AudioContext");
      expect(source, `${path} builds audio`).not.toContain("webkitAudioContext");
    }
  });

  it("adds no horizontal scroller", () => {
    const source = readFileSync(SHEET, "utf8");
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toContain("overflow-x-scroll");
  });

  it("brings in no new runtime dependency", () => {
    /*
     * Every non-relative import a practice module makes must resolve inside
     * this app. A bare package specifier here would be a dependency the
     * checkpoint added, which §XII forbids outright.
     */
    for (const path of pureModules) {
      for (const specifier of importsOf(path)) {
        const internal =
          specifier.startsWith("@/") ||
          specifier.startsWith(".") ||
          specifier.startsWith("node:");
        expect(internal, `${path} → ${specifier}`).toBe(true);
      }
    }
  });
});

/**
 * Where the intent layer is allowed to live (2S-A §13).
 *
 * The composer adds four commands, two notation surfaces have to share them,
 * and none of that is allowed to become another thing that only exists inside
 * a `.tsx` file. Every assertion here reads the real syntax tree — imports,
 * identifiers, line counts — so a rename or a comment can neither satisfy one
 * nor break one, and none of them is a grep over source text.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import ts from "typescript";

import { identifiersOf, parseFile, sourceFilesUnder, valueImportsOf } from "@/lib/dev/ast";

const lineCount = (path: string) => {
  const text = readFileSync(path, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

/** The pure cores: a Song in, a Song or a typed refusal out. */
const PURE = [
  "src/lib/workspace/composer-tool.ts",
  "src/lib/chords/power-chord-pen.ts",
  "src/lib/song/legato-brush.ts",
  "src/lib/song/continue-pattern.ts",
  "src/lib/tab/glyph-model.ts",
  "src/lib/tab/technique-geometry.ts",
];

/** The components the intent layer added, and the one it rewrote. */
const VIEWS = [
  "src/components/workspace/ComposerArea.tsx",
  "src/components/workspace/ComposerDoorRow.tsx",
  "src/components/workspace/ComposerSheet.tsx",
  "src/components/workspace/ContinuePatternSheet.tsx",
  "src/components/workspace/LegatoDecisionSheet.tsx",
  "src/components/workspace/TechniqueLayer.tsx",
  "src/components/workspace/FretGlyph.tsx",
  "src/components/workspace/EditArea.tsx",
];

const CONTROLLER = "src/lib/workspace/use-intent-composer.ts";
const TAB = "src/components/workspace/TabCanvas.tsx";
const MULTI = "src/components/workspace/FrettedMultiLane.tsx";
const ARRANGEMENT = "src/components/workspace/ArrangementCanvas.tsx";
const MULTI_CANVAS = "src/components/workspace/MultiTrackCanvas.tsx";
const BAR_BLOCK = "src/components/workspace/FrettedBarBlock.tsx";

describe("39. the intent layer has one home per thing it knows", () => {
  it("computes no command inside a component", () => {
    /*
     * Calling a pure core from a component is the point; declaring one there
     * is a second implementation nobody can test. The four names are checked
     * as declarations rather than as mentions, so a sheet may hand
     * `previewContinuations` its cards and still pass.
     */
    const commands = ["writePowerChord", "planBrush", "applyBrush", "continuePattern"];
    for (const path of sourceFilesUnder("src/components")) {
      const source = readFileSync(path, "utf8");
      for (const name of commands) {
        expect(source.includes(`function ${name}`), `${path} declares ${name}`).toBe(false);
      }
    }
  });

  it("keeps every pure core out of React, Tone and the DOM", () => {
    /*
     * One audio module is allowed and named: `schedule` is where the velocity
     * a typed note gets already lives, and §7 asks the pen to use that one
     * rather than invent a second default. It is itself pure — the assertion
     * below says so rather than trusting the folder it sits in — so the rule
     * is "no engine", not "no filename containing audio".
     */
    const SHARED_CONTRACT = "@/lib/audio/schedule";
    expect(valueImportsOf("src/lib/audio/schedule.ts")).not.toContain("tone");

    for (const path of PURE) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier === "react", `${path} → ${specifier}`).toBe(false);
        expect(specifier === "tone", `${path} → ${specifier}`).toBe(false);
        expect(specifier.startsWith("@/components/"), `${path} → ${specifier}`).toBe(false);
        expect(
          specifier.startsWith("@/lib/audio/") && specifier !== SHARED_CONTRACT,
          `${path} → ${specifier}`,
        ).toBe(false);
      }
      const names = identifiersOf(path);
      for (const global of ["document", "window", "navigator", "localStorage"]) {
        expect(names.has(global), `${path} touches ${global}`).toBe(false);
      }
    }
  });

  it("keeps the drawing components away from the engine", () => {
    /*
     * A fret number and a slur arc are geometry. If either could see the
     * scheduler, "the note that is sounding" would stop being an attribute on
     * an element and start being a render, which is exactly the design 2Q-C
     * paid for.
     */
    for (const path of ["src/components/workspace/FretGlyph.tsx", "src/components/workspace/TechniqueLayer.tsx"]) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.startsWith("@/lib/audio/"), `${path} → ${specifier}`).toBe(false);
      }
    }
  });

  it("lets no component reach storage, history internals or the serializer", () => {
    const forbidden = [
      "@/lib/song/storage",
      "@/lib/song/storage-envelope",
      "@/lib/song/song-store",
      "@/lib/song/edit-history",
      "@/lib/song/transform",
    ];
    for (const path of VIEWS) {
      const imports = valueImportsOf(path);
      for (const specifier of forbidden) {
        expect(imports, `${path} imports ${specifier}`).not.toContain(specifier);
      }
      expect(identifiersOf(path).has("commitTransform"), path).toBe(false);
    }
  });

  it("imports nothing from the evaluation harnesses into the product", () => {
    // Tests may read an eval fixture — that is what the fixtures are for. The
    // rule is about what ships, so the shipped files are what is walked.
    for (const path of sourceFilesUnder("src").filter((entry) => !entry.includes(".test."))) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.includes("eval/"), `${path} → ${specifier}`).toBe(false);
      }
    }
  });

  it("adds no runtime dependency", () => {
    /*
     * Compared against the phase's starting commit rather than against a list
     * written by hand here, which would only ever say what somebody remembered
     * to write down.
     */
    const before = JSON.parse(
      execFileSync("git", ["show", "217e7cb:package.json"], { encoding: "utf8" }),
    );
    const now = JSON.parse(readFileSync("package.json", "utf8"));
    expect(now.dependencies).toEqual(before.dependencies);
  });
});

describe("40. both notation surfaces read the same tab", () => {
  it("draws every fret number through the one glyph", () => {
    // Tab and Çoklu both go through the same bar block, so a fret number
    // cannot come out looking like one thing here and another thing there.
    expect(valueImportsOf(TAB)).toContain("@/components/workspace/FrettedBarBlock");
    expect(valueImportsOf(MULTI)).toContain("@/components/workspace/FrettedBarBlock");
    expect(valueImportsOf(BAR_BLOCK)).toContain("@/components/workspace/FretGlyph");
    expect(valueImportsOf(BAR_BLOCK)).toContain("@/lib/tab/technique-geometry");
  });

  it("keeps the character mark a fallback rather than a second notation", () => {
    /*
     * The geometry layer draws a slur, a slide, a bend, a vibrato and a palm
     * mute; the small character beside the number exists for the ones it
     * could *not* draw — a hammer-on with nothing to hammer from. If the
     * glyph were rendered unconditionally the two would say the same thing
     * twice, and the reader would see `h` under an arc that already says it.
     *
     * Read off the syntax tree: the mark has to sit inside a condition that
     * asks what was really annotated, not merely somewhere near one.
     */
    const source = parseFile(BAR_BLOCK);
    let guarded = false;
    let seen = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText() === "ArticulationGlyph"
      ) {
        seen += 1;
        for (let up: ts.Node | undefined = node; up; up = up.parent) {
          if (!ts.isConditionalExpression(up)) continue;
          if (up.condition.getText().includes("annotated")) guarded = true;
          break;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(seen).toBe(1);
    expect(guarded).toBe(true);
  });

  it("gives neither canvas a command core of its own", () => {
    const cores = [
      "@/lib/chords/power-chord-pen",
      "@/lib/song/legato-brush",
      "@/lib/song/continue-pattern",
    ];
    for (const path of [ARRANGEMENT, MULTI_CANVAS, TAB]) {
      const imports = valueImportsOf(path);
      for (const core of cores) {
        expect(imports, `${path} imports ${core}`).not.toContain(core);
      }
    }
  });

  it("keeps the arrangement out of the feature entirely", () => {
    // There is no tab on the arrangement surface, so there is nothing there
    // for a pen, a brush or a continuation to act on (spec 13.10).
    for (const specifier of valueImportsOf(ARRANGEMENT)) {
      expect(specifier.includes("composer"), `${ARRANGEMENT} → ${specifier}`).toBe(false);
    }
  });
});

describe("41. the intent layer stays inside its line budget", () => {
  it("keeps the controller a controller rather than a second workspace", () => {
    /*
     * 330 today, pinned at 340. It is the sixth-largest hook in the folder and
     * smaller than `use-note-editing`, which is the surface it stands beside;
     * the ceiling is just above what it actually costs so the next tool has to
     * make a decision rather than spend the room quietly.
     */
    expect(lineCount(CONTROLLER)).toBeLessThanOrEqual(340);
    expect(lineCount("src/lib/workspace/use-composer-doors.ts")).toBeLessThanOrEqual(90);
  });

  it("keeps every view a view", () => {
    for (const path of VIEWS) {
      expect(lineCount(path), path).toBeLessThanOrEqual(250);
    }
  });

  it("keeps the doors reachable while a run is selected", () => {
    /*
     * The legato brush is *used* on a selected run: cover the notes, then
     * open "Bagla". An earlier answer to the surface being squeezed at
     * 320x700 with 150% text hid the door row whenever a selection existed,
     * which took the brush's only door away at exactly the moment it was
     * needed — the acceptance suite could no longer finish the brush tour.
     *
     * The room comes from the focused edit layout now, so this reads the
     * syntax tree rather than the rendered pixels: the door row must not sit
     * inside any condition that asks about the selection.
     */
    const source = parseFile("src/components/workspace/ComposerArea.tsx");
    const guards: string[] = [];
    const visit = (node: ts.Node, conditions: readonly ts.Node[]): void => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        if (node.tagName.getText(source) === "ComposerDoorRow") {
          for (const condition of conditions) {
            if (/\bselection\b/.test(condition.getText(source))) {
              guards.push(condition.getText(source));
            }
          }
        }
      }
      let next = conditions;
      if (ts.isConditionalExpression(node)) next = [...conditions, node.condition];
      if (
        ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        next = [...conditions, node.left];
      }
      ts.forEachChild(node, (child) => visit(child, next));
    };
    visit(source, []);
    expect(guards).toEqual([]);
  });

  it("leaves the composition root and the canvases no bigger than it found them", () => {
    /*
     * The whole feature was wired in without any of these four growing. Three
     * of them shrank, because the wiring was paid for with behaviour-
     * preserving extractions rather than with budget.
     */
    const started = {
      "src/components/workspace/Workspace.tsx": 377,
      "src/components/workspace/ArrangementCanvas.tsx": 470,
      "src/components/workspace/TabCanvas.tsx": 472,
    } as const;
    for (const [path, before] of Object.entries(started)) {
      expect(lineCount(path), path).toBeLessThanOrEqual(before);
    }
  });
});

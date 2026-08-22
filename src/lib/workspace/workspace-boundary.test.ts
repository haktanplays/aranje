/**
 * The composition-root contract (2L-R, K-47).
 *
 * Workspace is glue: it may compose controllers and surfaces, and it may not
 * quietly grow back into the file everything lived in. Every assertion here
 * is about the real syntax tree — imports, identifiers, call sites — never
 * about wording, so a comment or a class name cannot satisfy or break one.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";

import {
  arithmeticIdentifiersOf,
  callCount,
  identifiersOf,
  jsxEventAttributeCount,
  useStateTypeArgs,
  valueImportsOf,
} from "@/lib/dev/ast";

const WORKSPACE = "src/components/workspace/Workspace.tsx";
const CANVAS = "src/components/workspace/ArrangementCanvas.tsx";

const lineCount = (path: string) => {
  const text = readFileSync(path, "utf8");
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

/** Every product source file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

const workspaceComponents = walk("src/components/workspace");
const workspaceHooks = readdirSync("src/lib/workspace")
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => `src/lib/workspace/${name}`);

describe("38. the composition root stays a composition root", () => {
  it("respects the line budgets honestly earned in 2L-R", () => {
    expect(lineCount(WORKSPACE)).toBeLessThanOrEqual(900);
    expect(lineCount(CANVAS)).toBeLessThanOrEqual(600);
  });

  it("owns no state of its own", () => {
    // The strongest single-owner proof there is: every piece of workspace
    // state lives in the hook that owns it, and the root composes.
    expect(callCount(WORKSPACE, "useState")).toBe(0);
  });

  it("imports no domain command implementation", () => {
    const names = identifiersOf(WORKSPACE);
    for (const command of [
      "applyEdit",
      "applyMoveOnsetGroup",
      "applyTransform",
      "applyBarCommand",
      "chooseOnset",
      "recordEdit",
    ]) {
      expect(names.has(command), command).toBe(false);
    }
  });

  it("touches no browser file API and no storage", () => {
    const names = identifiersOf(WORKSPACE);
    for (const api of [
      "FileReader",
      "Blob",
      "createObjectURL",
      "revokeObjectURL",
      "localStorage",
      "sessionStorage",
    ]) {
      expect(names.has(api), api).toBe(false);
    }
    const imports = valueImportsOf(WORKSPACE);
    expect(imports).not.toContain("@/lib/song/storage");
    expect(imports).not.toContain("@/lib/song/storage-envelope");
    expect(imports).not.toContain("@/lib/song/song-store");
    expect(imports).not.toContain("@/lib/project/project-file");
  });

  it("carries no history internals", () => {
    for (const path of [WORKSPACE, ...workspaceHooks]) {
      expect(arithmeticIdentifiersOf(path).has("cursor"), path).toBe(false);
      expect(identifiersOf(path).has("recordEdit"), path).toBe(false);
    }
  });
});

describe("39. one owner per state", () => {
  it("keeps the view state in the navigation controller alone", () => {
    const owners = [...workspaceHooks, ...workspaceComponents].filter((path) =>
      useStateTypeArgs(path).includes("WorkspaceView"),
    );
    expect(owners).toEqual(["src/lib/workspace/use-workspace-navigation.ts"]);
  });

  it("keeps the overlay enum in the overlay controller alone", () => {
    const owners = [...workspaceHooks, ...workspaceComponents].filter((path) =>
      useStateTypeArgs(path).some((arg) => arg.includes("WorkspaceSheet")),
    );
    expect(owners).toEqual(["src/lib/workspace/use-workspace-overlays.ts"]);
  });

  it("keeps the controllers from importing each other", () => {
    // The session hooks are siblings composed by the root; an edge between
    // them is the start of the next god module.
    for (const path of workspaceHooks) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier.startsWith("@/lib/workspace/"), `${path} → ${specifier}`).toBe(
          false,
        );
      }
    }
  });

  it("has no import cycle among the workspace modules", () => {
    const files = [...workspaceHooks, ...workspaceComponents];
    const byModule = new Map<string, string[]>();
    const toModule = (path: string) =>
      `@/${path.replace(/^src\//, "").replace(/\.(tsx|ts)$/, "")}`;
    for (const path of files) {
      byModule.set(
        toModule(path),
        valueImportsOf(path).filter((specifier) =>
          [...files.map(toModule)].includes(specifier),
        ),
      );
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (moduleId: string, trail: string[]): void => {
      if (done.has(moduleId)) return;
      expect(
        visiting.has(moduleId),
        `cycle: ${[...trail, moduleId].join(" → ")}`,
      ).toBe(false);
      visiting.add(moduleId);
      for (const next of byModule.get(moduleId) ?? []) {
        visit(next, [...trail, moduleId]);
      }
      visiting.delete(moduleId);
      done.add(moduleId);
    };
    for (const moduleId of byModule.keys()) visit(moduleId, []);
  });
});

describe("40. the arrangement stays one frame, one listener set", () => {
  it("runs its animation frame only in the follow-playhead hook", () => {
    const owner = "src/components/workspace/arrangement/use-follow-playhead.ts";
    expect(callCount(owner, "requestAnimationFrame")).toBe(2);
    for (const path of workspaceComponents) {
      if (path === owner) continue;
      if (path.endsWith("TabCanvas.tsx")) continue; // the tab's own single loop
      expect(callCount(path, "requestAnimationFrame"), path).toBe(0);
    }
    expect(
      callCount("src/components/workspace/TabCanvas.tsx", "requestAnimationFrame"),
    ).toBe(2);
  });

  it("gives a cell exactly the listeners it had", () => {
    // One click per cell component; the long press arrives through the one
    // shared `useLongPress` spread. A third per-cell handler is a regression
    // in a surface with hundreds of cells.
    expect(
      jsxEventAttributeCount(
        "src/components/workspace/arrangement/ArrangementCells.tsx",
      ),
    ).toBe(2);
  });

  it("keeps the arrangement children on pure models and typed props", () => {
    for (const path of [
      "src/components/workspace/arrangement/ArrangementCells.tsx",
      "src/components/workspace/arrangement/SelectionHandle.tsx",
    ]) {
      for (const specifier of valueImportsOf(path)) {
        expect(
          /^@\/lib\/(song|audio|project|copilot|settings)\//.test(specifier),
          `${path} → ${specifier}`,
        ).toBe(false);
      }
    }
  });
});

describe("41. eval stays out of the product", () => {
  it("no product module imports from eval/", () => {
    const roots = ["src/app", "src/components", "src/lib"].filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
    for (const dir of roots) {
      for (const path of walk(dir)) {
        for (const specifier of valueImportsOf(path)) {
          expect(/eval\//.test(specifier), `${path} → ${specifier}`).toBe(false);
        }
      }
    }
  });

  it("the shared harness is what the suites actually use", () => {
    // Consolidation that nothing imports is a new copy waiting to happen.
    const consumers = [
      "eval/storage/verify.mjs",
      "eval/bar-ops/verify.mjs",
      "eval/history/verify.mjs",
      "eval/project-file/verify.mjs",
    ];
    for (const path of consumers) {
      expect(
        valueImportsOf(path).some((specifier) =>
          specifier.endsWith("shared/harness.mjs"),
        ),
        path,
      ).toBe(true);
    }
  });
});

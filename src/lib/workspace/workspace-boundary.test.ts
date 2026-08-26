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
const MULTI_CANVAS = "src/components/workspace/MultiTrackCanvas.tsx";
const TAB_CANVAS = "src/components/workspace/TabCanvas.tsx";

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

/**
 * Hooks that exist only to call other hooks (2O-A §5).
 *
 * Listed rather than inferred from the name, so adding one is a decision
 * somebody made on purpose and can be seen in a diff.
 */
/**
 * Hooks that compose other controllers instead of owning state.
 *
 * They are allowed to import a controller precisely because they add nothing
 * of their own: each one exists so the composition root does not have to
 * spell the same relationship out several times. A hook earns a place here by
 * holding no `useState` of its own, which the rule below checks.
 */
const COMPOSITION_HOOKS = new Set([
  "src/lib/workspace/use-workspace-files.ts",
  "src/lib/workspace/use-tab-view.ts",
  // 2R-A §6: the armed kit's row is one decision made of a window and some
  // arithmetic. It calls both and remembers neither, which the test below
  // is what keeps true.
  "src/lib/workspace/use-armed-grid-row.ts",
]);

describe("38. the composition root stays a composition root", () => {
  it("respects the line budgets honestly earned in 2L-R and tightened since", () => {
    /*
     * 416 was accepted at 2L-R, 450 allowed for lifecycle wiring at 2L-B, and
     * the root has been under that ever since. 2Q-A pins the number it
     * actually stood at rather than the ceiling it was allowed: a third
     * surface is exactly the kind of work that spends a budget quietly, and
     * the wiring for it was paid for by extracting two things that were never
     * root work (`mixer-audio`, `use-select-track`).
     */
    expect(lineCount(WORKSPACE)).toBeLessThanOrEqual(379);
    expect(lineCount(CANVAS)).toBeLessThanOrEqual(470);
    // Budgeted from the start rather than discovered later (2Q-A §14).
    expect(lineCount(MULTI_CANVAS)).toBeLessThanOrEqual(500);
    /*
     * The tab had no budget until 2Q-C, which is how it reached 511 lines
     * unremarked. It is 472 now — the whole-song axis, the window and the
     * follow model went into a shared hook, and the bar frame into
     * `TabBarSlot` — and the ceiling is pinned just above that so the next
     * feature has to make the same choice rather than spending it quietly.
     */
    expect(lineCount(TAB_CANVAS)).toBeLessThanOrEqual(480);
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
    /*
     * The session hooks are siblings composed by the root; an edge between
     * them is the start of the next god module.
     *
     * The rule is about *controllers*, not about the folder. A controller may
     * own a pure module that lives beside it — `edit-gate`, and since 2N-A the
     * section-navigation transition — and pushing those somewhere else to
     * satisfy a path check would scatter the logic the §8 boundary exists to
     * keep together. What the next test enforces is that such a module really
     * is pure: no React, no controller of its own.
     */
    const isController = (specifier: string) =>
      specifier.startsWith("@/lib/workspace/use-");
    for (const path of workspaceHooks) {
      if (!path.includes("/use-")) continue;
      if (COMPOSITION_HOOKS.has(path)) continue;
      for (const specifier of valueImportsOf(path)) {
        expect(isController(specifier), `${path} → ${specifier}`).toBe(false);
      }
    }
  });

  /**
   * The one exception, and the price of it.
   *
   * A composition hook exists to call several controllers so the root does not
   * have to — `use-workspace-files` calls the backup, the export and the
   * library controllers because all three stand on the same ground, and
   * spelling that out three times in `Workspace.tsx` is how a composition root
   * turns back into a god module.
   *
   * What stops it becoming a fourth controller is that it may own **nothing**.
   * No state, no ref, no effect, no memo: it composes and returns. A
   * composition hook that started remembering something would be a controller
   * that had hidden itself behind this exemption, so the exemption checks.
   */
  it("lets a composition hook compose, and own nothing", () => {
    expect(COMPOSITION_HOOKS.size).toBeGreaterThan(0);
    for (const path of COMPOSITION_HOOKS) {
      const source = readFileSync(path, "utf8");
      for (const owned of ["useState", "useRef", "useEffect", "useMemo", "useReducer"]) {
        expect(source, `${path} owns ${owned}`).not.toContain(owned);
      }
    }
  });

  it("keeps the pure modules beside the controllers actually pure", () => {
    // A "pure helper" that reaches for React or for a controller is a second
    // controller wearing a filename that hides it from the rule above.
    const pureModules = workspaceHooks.filter((path) => !path.includes("/use-"));
    expect(pureModules.length).toBeGreaterThan(0);
    for (const path of pureModules) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier === "react", `${path} → ${specifier}`).toBe(false);
        expect(
          specifier.startsWith("@/lib/workspace/use-"),
          `${path} → ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("keeps the mixer out of the arrangement and off the engine (2L-C)", () => {
    /*
     * The arrangement draws bars; it has no business knowing how loud a
     * track is, and a mixer import there would be the first line of a second
     * mixing surface. The sheet is the other half of the same rule: it may
     * read a typed view-model and call back, and may not reach the audio
     * graph, the store, storage or the history itself.
     */
    for (const specifier of valueImportsOf(CANVAS)) {
      expect(/mix/i.test(specifier), `canvas → ${specifier}`).toBe(false);
    }
    const sheet = "src/components/workspace/MixerSheet.tsx";
    for (const specifier of valueImportsOf(sheet)) {
      expect(
        /^@\/lib\/(audio|song\/song-store|song\/storage)/.test(specifier),
        `${sheet} → ${specifier}`,
      ).toBe(false);
    }
    const names = identifiersOf(sheet);
    for (const forbidden of ["commit", "recordEdit", "localStorage"]) {
      expect(names.has(forbidden), `${sheet} uses ${forbidden}`).toBe(false);
    }
  });

  it("keeps export off the canvas and out of the components (2M-A)", () => {
    /*
     * The arrangement draws bars. An export import there would be the first
     * line of a second download path, and the reason there is only one is so
     * a future entitlement check has one place to live rather than three.
     *
     * The sheet is the other half: it may read a typed view-model and call
     * back, and may not reach Tone, the scheduler, the project serializer,
     * the WAV encoder or the MIDI writer. A component that could encode
     * could also encode differently from the controller.
     */
    for (const specifier of valueImportsOf(CANVAS)) {
      expect(/export|wav|midi/i.test(specifier), `canvas → ${specifier}`).toBe(false);
    }

    const sheet = "src/components/workspace/ExportSheet.tsx";
    for (const specifier of valueImportsOf(sheet)) {
      expect(
        /^(tone|@\/lib\/audio\/|@\/lib\/project\/project-file$|@\/lib\/export\/(wav-encoder|midi-writer|midi-plan|render-wav)$)/.test(
          specifier,
        ),
        `${sheet} → ${specifier}`,
      ).toBe(false);
    }

    // No component may mint or revoke an Object URL: that lifecycle has one
    // owner per flow, and a stale file is exactly what a second one produces.
    for (const path of workspaceComponents) {
      const names = identifiersOf(path);
      expect(names.has("createObjectURL"), `${path} mints a URL`).toBe(false);
      expect(names.has("revokeObjectURL"), `${path} revokes a URL`).toBe(false);
    }
  });

  it("gives the export exactly one implementation per format (2M-A)", () => {
    /*
     * Encoding lives in the pure cores and reaches the app through the one
     * controller. If a second module started calling `encodeWav` or
     * `writeMidiFile`, "the file the user gets" would stop having a single
     * definition.
     */
    const callers = [...workspaceComponents, ...workspaceHooks].filter((path) => {
      const names = identifiersOf(path);
      return names.has("encodeWav") || names.has("writeMidiFile");
    });
    expect(callers).toEqual(["src/lib/workspace/use-export.ts"]);
  });

  it("routes every lifecycle command through the one controller (2L-B)", () => {
    /*
     * The pure cores have exactly one caller. A sheet that imported
     * `applyTrackCommand` itself would be a second gate — one that could
     * commit without the ground, the no-op check or the survivor rule.
     */
    // The sheets may read a core's *vocabulary* (option helpers, labels);
    // the apply functions are what must stay single-callered.
    const applies = [
      "applySongCommand",
      "applySectionCommand",
      "applyTrackCommand",
    ];
    for (const path of [...workspaceComponents, ...workspaceHooks]) {
      if (path === "src/lib/workspace/use-lifecycle.ts") continue;
      const names = identifiersOf(path);
      for (const apply of applies) {
        expect(names.has(apply), `${path} calls ${apply}`).toBe(false);
      }
    }
    const owner = identifiersOf("src/lib/workspace/use-lifecycle.ts");
    for (const apply of applies) expect(owner.has(apply), apply).toBe(true);
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
  it("asks the browser for a frame in exactly one module", () => {
    /*
     * The two surfaces each drew a playhead and each had its own copy of the
     * same loop. They agreed, but nothing made them: the rule that decides
     * whether a phone burns frames while nothing is playing was written
     * twice, and a fix to one would not have reached the other.
     *
     * Now `playhead-loop.ts` owns it, and the browser's API is reached for in
     * exactly one place inside it — the default scheduler. Everything else,
     * including the loop's own two requests, goes through the injected one,
     * which is what makes "how many loops are alive" a countable question
     * rather than a claim. No component and no workspace hook may reach for a
     * frame itself.
     */
    const owner = "src/lib/workspace/playhead-loop.ts";
    expect(callCount(owner, "requestAnimationFrame")).toBe(1);
    expect(callCount(owner, "cancelAnimationFrame")).toBe(1);

    for (const path of [...workspaceComponents, ...workspaceHooks]) {
      if (path === owner) continue;
      expect(callCount(path, "requestAnimationFrame"), path).toBe(0);
      expect(callCount(path, "cancelAnimationFrame"), path).toBe(0);
    }
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

describe("41. the seven responsibilities 2N-A separated (spec 13.20 §8)", () => {
  /**
   * Each of them names a *pure* module, and the reason is the same every time:
   * a component that owned one of these would make it unreachable from a test
   * and impossible to share between the two surfaces that need it.
   */
  const OWNERS: Readonly<Record<string, string>> = {
    "onset selection intent": "src/lib/song/onset-selection.ts",
    "chain-impact preflight": "src/lib/song/chain-preflight.ts",
    "boundary detach/repair": "src/lib/song/chain-preflight.ts",
    "timing display formatter": "src/lib/music/rhythm-language.ts",
    "bar/section timing transform": "src/lib/song/timing-change.ts",
    "rhythm guide/beam model": "src/lib/tab/rhythm-guide.ts",
    // 2S-A §4: what a fret number *is*, and where a slur's arc goes, are
    // both answers a component would otherwise invent twice — once for the
    // Tab surface and once for Çoklu.
    "fret glyph model": "src/lib/tab/glyph-model.ts",
    "technique mark geometry": "src/lib/tab/technique-geometry.ts",
    "playing-onset mark": "src/lib/tab/playing-onset.ts",
    // 2S-A §6-§9: what the reader is holding, and what each tool would write.
    // A component that owned any of these would make it unreachable from a
    // test and impossible to share between the two notation surfaces.
    "composer tool model": "src/lib/workspace/composer-tool.ts",
    "power chord pen": "src/lib/chords/power-chord-pen.ts",
    "legato brush": "src/lib/song/legato-brush.ts",
    "pattern continuation": "src/lib/song/continue-pattern.ts",
    "section navigation transition": "src/lib/workspace/section-navigation.ts",
  };

  it("keeps every one of them out of React", () => {
    for (const [what, path] of Object.entries(OWNERS)) {
      for (const specifier of valueImportsOf(path)) {
        expect(specifier === "react", `${what}: ${path} → ${specifier}`).toBe(false);
        expect(
          specifier.startsWith("@/components/"),
          `${what}: ${path} → ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("keeps the components out of the logic", () => {
    /*
     * A component may *call* these modules; what it may not do is compute the
     * same answers itself. The three that would be easiest to reimplement in
     * a render — beam levels, the beat grouping and the plain rhythm reading —
     * are checked by name, on the syntax tree rather than on the text.
     */
    const forbidden = ["buildRhythmGuide", "beamLevels", "readRhythm"];
    for (const path of workspaceComponents) {
      const identifiers = identifiersOf(path);
      for (const name of forbidden) {
        if (!identifiers.has(name)) continue;
        // Calling one is fine; declaring one is a second implementation.
        const source = readFileSync(path, "utf8");
        expect(source.includes(`function ${name}`), `${path} declares ${name}`).toBe(
          false,
        );
      }
    }
  });

  it("gives the chain decision exactly one set of callers", () => {
    /*
     * Named rather than merely absent from the workspace folder, which would
     * pass for a codebase that had moved the second implementation somewhere
     * else. `transform` applies the preflight's edits and `use-transform`
     * carries the reader's decision to it; a third name here would be a second
     * opinion about what a chain costs.
     */
    const users = walk("src/lib")
      .concat(walk("src/components"))
      .filter((path) => valueImportsOf(path).includes("@/lib/song/chain-preflight"))
      .sort();
    expect(users).toEqual([
      "src/lib/song/transform.ts",
      "src/lib/song/use-transform.ts",
    ]);
  });
});

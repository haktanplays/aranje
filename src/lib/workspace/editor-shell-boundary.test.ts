/**
 * One shell, and the things it may not become again (2V-B.4 §4, §17).
 *
 * ## The measurement this file freezes
 *
 * At `c11a758` the editor's real work happened in `FretSheet` — `fixed
 * inset-0 z-30`, up to `max-h-[85dvh]`, headed "Bar 1 · slot 1 · tel 1". The
 * §3 inventory found `gridHit = COVERED` at all six viewports in both the tap
 * and the long-press state. The grid, which is the point of the screen, was
 * not on the screen.
 *
 * Every assertion below reads the real source or the real model, so a comment
 * cannot satisfy one and a rename cannot break one. Together they say: the
 * panels are rows in the flow, they belong to the four groups the reader
 * already knows, they speak in words rather than in the format's vocabulary,
 * and a tap and a long press open the same shell.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import ts from "typescript";

import { identifiersOf, parseFile, valueImportsOf } from "@/lib/dev/ast";
import { DOCK_GROUPS } from "@/lib/workspace/editor-dock";
import {
  SHELF_PANELS,
  SHELF_PANEL_IDS,
  panelAvailability,
  panelForGesture,
  panelsOfGroup,
} from "@/lib/workspace/shelf-panel";

const SHELF = "src/components/workspace/shelf";
const shelfFiles = readdirSync(SHELF)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => `${SHELF}/${name}`);
/**
 * The file with its comments taken out.
 *
 * The headers here quote the sheet they replaced — `fixed inset-0 z-30`,
 * "Bar 1 · slot 1 · tel 1" — because that measurement is why these files
 * exist. Scanning the raw text would flag the description of the problem as
 * the problem.
 */
const read = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");

/** What a beginner's first surface may never say (§6, §13). */
const JARGON = [
  /\bticks?\b/iu,
  /\bppq\b/iu,
  /\bslot\b/iu,
  /\bsubdivision\b/iu,
  /\bresolution\b/iu,
  /\bquantis/iu,
  /\bBar \d/u,
  /\bvelocity\b/iu,
];

/** Every string a reader could actually see in a component. */
function visibleText(source: string): string[] {
  /* JSX text between tags, plus the string literals passed to `label`. */
  const out: string[] = [];
  for (const match of source.matchAll(/label=\{?"([^"]+)"\}?/gu)) out.push(match[1]!);
  for (const match of source.matchAll(/>\s*([A-Za-zÇĞİÖŞÜçğıöşü][^<>{}\n]{2,})\s*</gu)) {
    out.push(match[1]!.trim());
  }
  return out;
}

describe("61. the shelf is a shelf, not a sheet in disguise", () => {
  it("mounts every panel in the flow, with no scrim and no full screen", () => {
    for (const path of [...shelfFiles, "src/components/workspace/EditorDock.tsx"]) {
      const source = read(path);
      expect(source, `${path} is fixed`).not.toMatch(/className="[^"]*\bfixed\b/u);
      expect(source, `${path} covers the screen`).not.toMatch(/inset-0/u);
      expect(source, `${path} is a sheet`).not.toMatch(/\bz-[23]\d\b/u);
      expect(source, `${path} takes 85% of the screen`).not.toContain("85dvh");
    }
  });

  it("opens no sheet component from inside a panel", () => {
    for (const path of shelfFiles) {
      for (const specifier of valueImportsOf(path)) {
        expect(
          /Sheet$/u.test(specifier),
          `${path} imports the sheet ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("keeps the panel region scrollable and bounded rather than tall", () => {
    const dock = read("src/components/workspace/EditorDock.tsx");
    expect(dock).toContain("data-shelf-panel");
    expect(dock).toMatch(/max-h-\[[123]\d?dvh\]/u);
    expect(dock).toContain("overflow-y-auto");
  });

  it("caps the shelf itself, so a panel cannot squeeze the staff to nothing", () => {
    /*
     * Measured, not assumed. With the panel bounded but the shelf not, the
     * note panel took the shelf to 481px at 384x692 and the staff's visible
     * height to **zero** — the sheet this batch removed, arrived at from the
     * other direction. The cap and the internal scroll are what stop it.
     */
    const css = readFileSync("src/app/globals.css", "utf8");
    const shelf = css.slice(css.indexOf(".workspace-shelf {"));
    const block = shelf.slice(0, shelf.indexOf("}"));
    expect(block).toMatch(/max-height:\s*\d+dvh/u);
    expect(block).toContain("overflow-y: auto");
  });

  it("gives every control a 44px target through the one constant", () => {
    const controls = read(`${SHELF}/ShelfControls.tsx`);
    expect(valueImportsOf(`${SHELF}/ShelfControls.tsx`)).toContain("@/lib/ui/interaction");
    /* Four primitives, four targets: nothing here sets its own height. */
    expect(controls.match(/MIN_TOUCH_TARGET_PX/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(controls).not.toMatch(/minHeight:\s*\d/u);
  });

  it("has at most one loud button on the screen at a time", () => {
    /*
     * Counted off the syntax tree rather than by grepping for the tag: a
     * panel may well *write* two primaries — the fast run's next step is
     * "Bu bölümü sıklaştır" until the reader agrees and "Uygula" after — as
     * long as they are the two arms of one condition and so can never be
     * drawn together. Two unconditional ones are the thing §17 forbids.
     */
    for (const path of shelfFiles) {
      if (path.endsWith("ShelfControls.tsx") || path.endsWith("ShelfPanels.tsx")) continue;
      const source = parseFile(path);
      const groups = new Set<ts.Node>();
      let loose = 0;
      const visit = (node: ts.Node): void => {
        const isPrimary =
          (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          node.tagName.getText(source) === "ShelfPrimary";
        if (isPrimary) {
          let branch: ts.Node | undefined;
          for (let up: ts.Node | undefined = node; up; up = up.parent) {
            if (ts.isConditionalExpression(up)) {
              branch = up;
              break;
            }
          }
          if (branch) groups.add(branch);
          else loose += 1;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      /* One unconditional primary, or one condition choosing between them. */
      expect(loose + groups.size, `${path} can draw two primaries at once`).toBeLessThanOrEqual(1);
    }
  });

  it("stacks no card inside a card", () => {
    for (const path of shelfFiles) {
      expect(read(path), `${path} draws a card`).not.toMatch(/\brounded-2xl\b|\bshadow-/u);
    }
  });
});

describe("62. the panels belong to the four groups the reader knows", () => {
  it("puts every panel in one of them, and never invents a fifth", () => {
    for (const id of SHELF_PANEL_IDS) {
      expect(DOCK_GROUPS, id).toContain(SHELF_PANELS[id].group);
    }
    const grouped = DOCK_GROUPS.flatMap((group) => panelsOfGroup(group).map((meta) => meta.id));
    expect(new Set(grouped)).toEqual(new Set(SHELF_PANEL_IDS));
  });

  it("names each panel once, in words", () => {
    const labels = SHELF_PANEL_IDS.map((id) => SHELF_PANELS[id].label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const id of SHELF_PANEL_IDS) {
      const meta = SHELF_PANELS[id];
      expect(meta.label).not.toContain("_");
      expect(meta.hint.length, id).toBeGreaterThan(0);
      /* A hint is one line, never a second paragraph (§17). */
      expect(meta.hint, id).not.toContain("\n");
    }
  });

  it("sends a tap and a long press to the same shell", () => {
    const tap = panelForGesture({ cellSelected: true, rangeSelected: false });
    const hold = panelForGesture({ cellSelected: false, rangeSelected: true });
    expect(SHELF_PANEL_IDS).toContain(tap!);
    expect(SHELF_PANEL_IDS).toContain(hold!);
    /* Different subject, same surface — which is the whole of §4. */
    expect(tap).not.toBe(hold);
    expect(panelForGesture({ cellSelected: false, rangeSelected: false })).toBeNull();
  });

  it("explains every panel it greys out", () => {
    const contexts = [
      { hasCell: false, hasSelection: false, fretted: true, canEdit: true },
      { hasCell: false, hasSelection: false, fretted: false, canEdit: true },
      { hasCell: true, hasSelection: true, fretted: true, canEdit: false },
    ];
    let disabled = 0;
    for (const context of contexts) {
      for (const id of SHELF_PANEL_IDS) {
        const state = panelAvailability(id, context);
        if (state.state !== "disabled") continue;
        disabled += 1;
        expect(state.reason, id).toBeTruthy();
        for (const pattern of JARGON) {
          expect(state.reason!, `${id}: ${state.reason}`).not.toMatch(pattern);
        }
      }
    }
    /* The loop above is not vacuous. */
    expect(disabled).toBeGreaterThan(3);
  });
});

describe("63. the shelf speaks Turkish, not Song Contract", () => {
  it("shows no tick, no slot, no PPQ and no 'Bar 4' on any panel", () => {
    for (const path of shelfFiles) {
      for (const text of visibleText(read(path))) {
        for (const pattern of JARGON) {
          expect(text, `${path}: "${text}"`).not.toMatch(pattern);
        }
      }
    }
  });

  it("names a measure through the one authority that spells it", () => {
    /*
     * Three panels say which measure they are about, and all three ask
     * `measureLabel`. Nothing builds the name itself, so "4. ölçü" cannot
     * become "Bar 4" or "ölçü 4" in one place and not the others.
     */
    const namers = shelfFiles.filter((path) => identifiersOf(path).has("measureLabel"));
    expect(namers.length).toBeGreaterThanOrEqual(3);
    /*
     * Saying "bu ölçüde" in a sentence is ordinary Turkish and welcome. What
     * is forbidden is *numbering* one by hand — a digit or an interpolation
     * next to the word — because that is the spelling `measureLabel` owns.
     */
    for (const path of shelfFiles) {
      expect(read(path), `${path} numbers a measure itself`).not.toMatch(
        /(\d|\$\{[^}]*\})\s*\.?\s*ölçü/u,
      );
      expect(read(path), `${path} says Bar N`).not.toMatch(/\bBar\s*\d/u);
    }
  });

  it("reaches no store, no history and no engine from a panel", () => {
    for (const path of shelfFiles) {
      for (const specifier of valueImportsOf(path)) {
        expect(
          /^@\/lib\/(audio|song\/song-store|song\/storage|song\/edit-history|project)/.test(
            specifier,
          ),
          `${path} → ${specifier}`,
        ).toBe(false);
      }
      expect(identifiersOf(path).has("localStorage"), path).toBe(false);
    }
  });
});

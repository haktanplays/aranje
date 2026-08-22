/**
 * Where the project-file code is allowed to reach (spec 13.15, 2L-A).
 *
 * Checked against the **real import graph**: the files are parsed with the
 * TypeScript compiler and the assertions are about actual import edges, not
 * about strings — renaming a variable or rewording a comment cannot break
 * these, and hiding an import inside a comment cannot satisfy them.
 * The export surfaces are read from the loaded modules themselves.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";

/** Every module specifier a file imports, exports from, or dynamic-imports. */
function importsOf(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

const PURE_MODULES = [
  "src/lib/project/project-file.ts",
  "src/lib/project/project-file-errors.ts",
  "src/lib/project/project-file-name.ts",
];

const HOOK = "src/lib/project/use-project-file.ts";

const COMPONENTS = readdirSync("src/components/workspace")
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => `src/components/workspace/${name}`);

describe("34. the pure project modules stay pure", () => {
  it("import no React, no engine, no storage and no component", () => {
    for (const path of PURE_MODULES) {
      for (const specifier of importsOf(path)) {
        expect(specifier, path).not.toMatch(/^react(-dom)?$/);
        expect(specifier, path).not.toBe("tone");
        expect(specifier, path).not.toMatch(/^next(\/|$)/);
        expect(specifier, path).not.toMatch(/^@\/components\//);
        // The project file must never learn about the storage envelope:
        // an import edge here is the road recovery state takes into a backup.
        expect(specifier, path).not.toBe("@/lib/song/storage");
        expect(specifier, path).not.toBe("@/lib/song/storage-envelope");
        expect(specifier, path).not.toBe("@/lib/song/song-store");
        expect(specifier, path).not.toBe("@/lib/song/edit-history");
      }
    }
  });

  it("load without a browser", async () => {
    // Node has no window, document, Blob-URL or FileReader; a pure module
    // that touched any of them at import time would have failed this import.
    await import("@/lib/project/project-file");
    await import("@/lib/project/project-file-errors");
    await import("@/lib/project/project-file-name");
  });
});

describe("35. the hook orchestrates but never persists", () => {
  it("reaches storage only through the injected commit", () => {
    for (const specifier of importsOf(HOOK)) {
      expect(specifier).not.toBe("@/lib/song/storage");
      expect(specifier).not.toBe("@/lib/song/storage-envelope");
      expect(specifier).not.toBe("@/lib/song/song-store");
      expect(specifier).not.toMatch(/^@\/components\//);
      expect(specifier).not.toBe("tone");
    }
  });
});

describe("36. components take the flow through the hook", () => {
  it("no component imports the parser/serializer module", () => {
    for (const path of COMPONENTS) {
      for (const specifier of importsOf(path)) {
        expect(specifier, path).not.toBe("@/lib/project/project-file");
      }
    }
  });

  it("Workspace holds no project-file machinery of its own", () => {
    const specifiers = importsOf("src/components/workspace/Workspace.tsx");
    expect(specifiers).toContain("@/lib/project/use-project-file");
    expect(specifiers).not.toContain("@/lib/project/project-file");
    expect(specifiers).not.toContain("@/lib/project/project-file-errors");
    expect(specifiers).not.toContain("@/lib/project/project-file-name");
  });

  it("ArrangementCanvas gained no project wiring", () => {
    for (const specifier of importsOf("src/components/workspace/ArrangementCanvas.tsx")) {
      expect(specifier).not.toMatch(/^@\/lib\/project\//);
    }
  });
});

describe("37. export surfaces", () => {
  it("the contract module exposes exactly its contract", async () => {
    const surface = Object.keys(await import("@/lib/project/project-file")).sort();
    expect(surface).toEqual([
      "PROJECT_FILE_FORMAT",
      "PROJECT_FILE_VERSION",
      "exportProject",
      "importTooLarge",
      "parseProjectText",
      "projectPreview",
      "serializeProjectFile",
    ]);
  });

  it("the errors module exposes the codes' sentences and nothing else", async () => {
    const surface = Object.keys(await import("@/lib/project/project-file-errors")).sort();
    expect(surface).toEqual(["EXPORT_BLOCKED_MESSAGE", "PROJECT_FILE_MESSAGES"]);
  });

  it("the name module exposes the naming contract", async () => {
    const surface = Object.keys(await import("@/lib/project/project-file-name")).sort();
    expect(surface).toEqual([
      "FALLBACK_FILE_STEM",
      "PROJECT_FILE_EXTENSION",
      "PROJECT_FILE_MIME",
      "projectFileName",
    ]);
  });
});

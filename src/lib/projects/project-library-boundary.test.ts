/**
 * Where the project library is allowed to reach (spec 13.21 §26, 2O-A).
 *
 * Checked against the **real import graph**, parsed with the TypeScript
 * compiler: the assertions are about actual import edges, so renaming a
 * variable or rewording a comment cannot break them and hiding an import in a
 * comment cannot satisfy them. No new grep-based architecture test.
 *
 * What these rules are protecting is one thing said several ways: the library
 * has one storage layer, one parser, one id allocator and one place a key is
 * built. Every duplicate of any of those is a second answer waiting to
 * disagree with the first, on a device nobody is watching.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import ts from "typescript";

import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  serializeProjectFile,
} from "@/lib/project/project-file";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(path) && !path.includes(".test.") ? [path] : [];
  });
}

/** Every module specifier a file imports, exports from, or dynamic-imports. */
/** Import edges that survive to runtime — `import type` is not reach. */
function valueImportsOf(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.isTypeOnly !== true
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

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
      specifiers.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/**
 * Real calls, not the words for them.
 *
 * A text search reads a module's own explanation of why it does not read a
 * clock as evidence that it does — the same trap the project-file rule below
 * fell into. The AST only sees calls that will actually run.
 */
function callNames(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) names.push(node.expression.getText(source));
    if (ts.isNewExpression(node)) names.push(`new ${node.expression.getText(source)}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

const PROJECT_MODULES = walk("src/lib/projects");
const COMPONENTS = walk("src/components");

/** The React-free half: everything that is not the session or the port. */
const PURE_PROJECT_MODULES = PROJECT_MODULES.filter(
  (path) => !path.endsWith("project-session.ts"),
);

describe("137. the pure project modules stay out of the browser", () => {
  it("imports no React, no Tone, no Next and no component", () => {
    expect(PURE_PROJECT_MODULES.length).toBeGreaterThan(5);
    for (const path of PURE_PROJECT_MODULES) {
      for (const specifier of importsOf(path)) {
        expect(specifier, `${path} → ${specifier}`).not.toMatch(
          /^(react|react-dom|tone|next)(\/|$)/,
        );
        expect(specifier, `${path} → ${specifier}`).not.toMatch(/^@\/components\//);
      }
    }
  });

  it("names no clock, no randomness and no uuid anywhere near an id", () => {
    /*
     * The id has to be reproducible: the same catalog and the same command
     * must give the same answer on every run, or no test can state what a
     * create *does*. A timestamp would also collide inside one millisecond,
     * which here means one project's payload written over another's.
     */
    for (const path of PURE_PROJECT_MODULES) {
      const calls = callNames(path);
      /*
       * Nothing here may *read* a clock or a random source. `updatedAt` is a
       * value the caller passes in, which is what makes five runs of a test
       * byte-equal.
       */
      expect(calls, path).not.toContain("Date.now");
      expect(calls, path).not.toContain("Math.random");
      expect(calls, path).not.toContain("crypto.randomUUID");
      /*
       * `new Date(x)` is different: it formats a number somebody was already
       * given. The copy table turns `updatedAt` into "Bugün 22:14" and cannot
       * invent a time it was not handed. Every other module is held to the
       * stricter line, because a `new Date()` there would be a clock read
       * wearing a constructor.
       */
      if (!path.endsWith("project-copy.ts")) {
        expect(calls, path).not.toContain("new Date");
      }
    }
  });

  it("keeps `eval/` out of production code", () => {
    for (const path of [...PROJECT_MODULES, ...COMPONENTS]) {
      for (const specifier of importsOf(path)) {
        expect(specifier, path).not.toMatch(/(^|\/)eval\//);
      }
    }
  });
});

describe("138. components see a controller and nothing under it", () => {
  it("no component imports storage, the parser, the envelope or the commands", () => {
    const forbidden = [
      "@/lib/projects/project-storage",
      "@/lib/projects/project-catalog",
      "@/lib/projects/project-record",
      "@/lib/projects/project-commands",
      "@/lib/projects/project-migration",
      "@/lib/projects/project-session",
      "@/lib/projects/active-project",
      "@/lib/song/storage",
      "@/lib/song/storage-envelope",
      "@/lib/song/song-store",
    ];
    /*
     * Value imports only. `RecoveryBanner` takes the `RecoveryState` *type*
     * from `storage.ts` so its four sentences stay in one table — a type
     * cannot reach storage at runtime, and forcing it somewhere else would
     * split the table it exists to share.
     */
    for (const path of COMPONENTS) {
      for (const specifier of valueImportsOf(path)) {
        expect(forbidden, `${path} → ${specifier}`).not.toContain(specifier);
      }
    }
  });

  it("lets components read only the summary, the copy table and the handle", () => {
    const allowed = new Set([
      "@/lib/projects/project-summary",
      "@/lib/projects/project-copy",
      "@/lib/workspace/use-project-library",
    ]);
    for (const path of COMPONENTS) {
      for (const specifier of importsOf(path)) {
        if (!specifier.startsWith("@/lib/projects/")) continue;
        expect(allowed.has(specifier), `${path} → ${specifier}`).toBe(true);
      }
    }
  });

  it("gives no component its own localStorage", () => {
    for (const path of COMPONENTS) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("localStorage");
      expect(source, path).not.toContain("sessionStorage");
    }
  });

  it("keeps the library sheets away from the download machinery", () => {
    for (const path of [
      "src/components/workspace/ProjectLibrarySheet.tsx",
      "src/components/workspace/ProjectDeleteSheet.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("createObjectURL");
      expect(source, path).not.toContain("commit(");
    }
  });

  it("leaves the arrangement canvas out of it entirely", () => {
    for (const specifier of importsOf("src/components/workspace/ArrangementCanvas.tsx")) {
      expect(specifier).not.toMatch(/^@\/lib\/projects\//);
      expect(specifier).not.toBe("@/lib/workspace/use-project-library");
    }
  });
});

describe("139. one storage layer, one key, one allocator", () => {
  it("builds a project key in exactly one module", () => {
    const owner = "src/lib/projects/project-storage.ts";
    for (const path of [...PROJECT_MODULES, ...COMPONENTS]) {
      if (path === owner) continue;
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("aranje.project.");
    }
  });

  it("touches setItem and removeItem in exactly one module", () => {
    /*
     * Everything that writes goes through `project-storage.ts`, which is what
     * makes the physical operation order in §10 a property of the code rather
     * than of five call sites that currently agree.
     */
    const owner = "src/lib/projects/project-storage.ts";
    for (const path of PROJECT_MODULES) {
      if (path === owner) continue;
      const source = readFileSync(path, "utf8");
      // `removeItem(SONG_KEY)` in the migration is the legacy key, and it is
      // the one deletion that is not a project's — it is named, not generic.
      const calls = [...source.matchAll(/storage\.(setItem|removeItem)\(/g)];
      const allowed = path.endsWith("project-migration.ts") ? 1 : 0;
      expect(calls.length, `${path} writes directly`).toBeLessThanOrEqual(allowed);
    }
  });

  it("keeps the song envelope's decisions shared rather than copied", () => {
    // `decideLoad` and `nextEnvelope` are imported by the record, never
    // reimplemented: one definition of "current, then previous, then give up".
    const record = importsOf("src/lib/projects/project-record.ts");
    expect(record).toContain("@/lib/song/storage-envelope");
    const source = readFileSync("src/lib/projects/project-record.ts", "utf8");
    expect(source).not.toContain("safeParse(shell.data.current)");
  });
});

describe("140. the catalog never reaches a fingerprint, a request or a file", () => {
  it("is not imported by the fingerprint, the Copilot contract or the project file", () => {
    const outward = [
      ...walk("src/lib/copilot"),
      ...walk("src/lib/project"),
    ];
    for (const path of outward) {
      for (const specifier of importsOf(path)) {
        expect(specifier, `${path} → ${specifier}`).not.toMatch(
          /^@\/lib\/projects\/project-(catalog|storage|record|migration|session|commands)/,
        );
      }
    }
  });

  it("does not let the project-file serializer learn about a library", () => {
    /*
     * Measured on the import graph and on the bytes, not on the prose: the
     * file's own header explains at length that it carries no revision, and a
     * word search would read that explanation as a violation of itself.
     */
    for (const specifier of importsOf("src/lib/project/project-file.ts")) {
      expect(specifier).not.toMatch(/^@\/lib\/projects\//);
    }
    const written = serializeProjectFile({
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      song: SAMPLE_SONG,
    });
    const parsed = JSON.parse(written) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["format", "song", "version"]);
    for (const word of ["projectId", "project-catalog", "activeProjectId", "revision"]) {
      expect(written, `the file carries ${word}`).not.toContain(word);
    }
  });
});

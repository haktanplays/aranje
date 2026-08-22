/**
 * Responsibility inventory for 2L-R, measured off the real AST — not grep.
 *
 *   npx tsx eval/orchestration-refactor/inventory.ts BEFORE.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function counts(path: string) {
  const source = parse(path);
  const hooks: Record<string, number> = {
    useState: 0, useEffect: 0, useMemo: 0, useCallback: 0, useRef: 0,
  };
  let handlers = 0;
  let jsxEventProps = 0;
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (hooks[name] !== undefined) hooks[name] += 1;
      if (name === "useCallback") handlers += 1;
    }
    if (
      (ts.isImportDeclaration(node)) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) imports.push(node.moduleSpecifier.text);
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText())) jsxEventProps += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const text = readFileSync(path, "utf8");
  return {
    lines: text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
    hooks,
    useCallbackHandlers: handlers,
    jsxEventProps,
    importCount: imports.length,
    imports,
  };
}

const workspace = counts("src/components/workspace/Workspace.tsx");
const arrangement = counts("src/components/workspace/ArrangementCanvas.tsx");

const out = process.argv[2] ?? "BEFORE.json";
writeFileSync(
  `eval/orchestration-refactor/${out}`,
  `${JSON.stringify({ workspace, arrangement }, null, 2)}\n`,
);
console.log(JSON.stringify({
  workspace: { ...workspace, imports: workspace.importCount },
  arrangement: { ...arrangement, imports: arrangement.importCount },
}, null, 1));

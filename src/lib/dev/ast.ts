/**
 * AST probes for the boundary tests (2L-R).
 *
 * The architecture tests used to read source as *text*, which made them
 * comment-sensitive: a Tailwind class or a reworded sentence could flip one.
 * These helpers parse the real syntax tree instead, so a test asserts what
 * the code *does* — which modules it imports, which identifiers it computes
 * with, which actions it commits — and nothing about how it is worded.
 *
 * Test-support only: product code never imports `@/lib/dev`.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

export function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

/** Every module specifier a file imports, exports from, or dynamic-imports. */
export function importsOf(path: string): string[] {
  const source = parseFile(path);
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

/**
 * Module specifiers imported with a *runtime* edge — `import type` and
 * fully type-only named bindings are excluded, because a type disappears at
 * compile time and cannot call anything.
 */
export function valueImportsOf(path: string): string[] {
  const source = parseFile(path);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly === true ||
        (clause?.name === undefined &&
          clause?.namedBindings !== undefined &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
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

/**
 * The `kind` of every action passed to a `commit(...)` call in the file.
 *
 * Finds calls whose callee is named `commit` (bare or as a property) and
 * reads the string literal `kind` off the second argument's object literal.
 * A commit whose second argument is not an object with a literal kind is
 * reported as "<unnamed>", so a test can insist that no step is anonymous.
 */
export function commitActionKinds(path: string): string[] {
  const source = parseFile(path);
  const kinds: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name === "commit") {
        const action = node.arguments[1];
        let kind = "<unnamed>";
        if (action !== undefined && ts.isObjectLiteralExpression(action)) {
          for (const property of action.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === "kind" &&
              ts.isStringLiteral(property.initializer)
            ) {
              kind = property.initializer.text;
            }
          }
        }
        kinds.push(kind);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return kinds;
}

/** How many times the file *calls* an identifier by this name. */
export function callCount(path: string, name: string): number {
  const source = parseFile(path);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/**
 * The first type argument of every `useState<...>()` call, as source text.
 * How a test asserts that exactly one module owns a piece of typed state.
 */
export function useStateTypeArgs(path: string): string[] {
  const source = parseFile(path);
  const args: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useState" &&
      node.typeArguments?.[0] !== undefined
    ) {
      args.push(node.typeArguments[0].getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return args;
}

/** How many JSX attributes in the file are event handlers (`on[A-Z]...`). */
export function jsxEventAttributeCount(path: string): number {
  const source = parseFile(path);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(source))) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/**
 * Every identifier the file's *code* mentions — declarations, references,
 * property names. Comments and string literals are not identifiers, which is
 * the entire point: `cursor-pointer` in a className cannot appear here.
 */
export function identifiersOf(path: string): Set<string> {
  const source = parseFile(path);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * Identifiers and property names that take part in arithmetic (`+ - * /`,
 * `+= -=`, `++ --`) anywhere in the file. This is what "does cursor
 * arithmetic" actually means, as syntax rather than as a substring.
 */
export function arithmeticIdentifiersOf(path: string): Set<string> {
  const source = parseFile(path);
  const names = new Set<string>();

  const collect = (expression: ts.Node): void => {
    if (ts.isIdentifier(expression)) names.add(expression.text);
    if (ts.isPropertyAccessExpression(expression)) {
      names.add(expression.name.text);
      collect(expression.expression);
    }
    if (ts.isParenthesizedExpression(expression)) collect(expression.expression);
  };

  const ARITHMETIC = new Set([
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
  ]);

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind)) {
      collect(node.left);
      collect(node.right);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      collect(node.operand);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * Every numeric literal in the file, as written.
 *
 * For rules of the shape "this number lives in exactly one place". Reading it
 * off the syntax tree rather than out of the text means a comment explaining
 * the number, or a string that happens to contain it, does not count as a
 * second copy — and a copy hidden inside an expression does.
 */
export function numericLiteralsOf(path: string): Set<number> {
  const source = parseFile(path);
  const values = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node)) values.add(Number(node.text));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

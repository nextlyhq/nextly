/**
 * The parse every source-reading check shares, and the walk they use to ask
 * what encloses a node.
 */
import type { Node } from "oxc-parser";
import { describe, expect, it } from "vitest";

import { parseSource, walk } from "./parse-source.mjs";

/** `Identifier` names in visiting order, each with the node types above it. */
function identifiers(code: string, fileName = "probe.ts"): string[] {
  const found: string[] = [];
  walk(parseSource(code, fileName).program, (node, ancestors) => {
    if (node.type !== "Identifier") return;
    found.push(
      `${node.name} < ${ancestors.map((above: Node) => above.type).join(" < ")}`
    );
  });
  return found;
}

describe("parseSource", () => {
  it("returns the program of a file it can read", () => {
    expect(
      parseSource("export const a = 1;", "a.ts").program.body
    ).toHaveLength(1);
  });

  it("refuses a file it cannot read rather than returning its empty program", () => {
    // oxc answers a syntax error with an empty program; that read as "nothing
    // here" is a clean result over a file nobody read.
    expect(() => parseSource("const = ;", "broken.ts")).toThrow(
      /broken\.ts cannot be parsed/
    );
  });

  it("reads the language from the file name", () => {
    // Valid TSX, and a syntax error as plain `.ts`, where `<div>` opens a type
    // assertion that never closes.
    const jsx = "export const C = () => <div>{a}</div>;";
    expect(() => parseSource(jsx, "c.tsx")).not.toThrow();
    expect(() => parseSource(jsx, "c.ts")).toThrow(/c\.ts cannot be parsed/);
  });
});

describe("walk", () => {
  it("visits in source order, each node with the chain above it", () => {
    expect(identifiers("f(a, () => g(b));")).toEqual([
      "f < Program < ExpressionStatement < CallExpression",
      "a < Program < ExpressionStatement < CallExpression",
      "g < Program < ExpressionStatement < CallExpression < ArrowFunctionExpression < CallExpression",
      "b < Program < ExpressionStatement < CallExpression < ArrowFunctionExpression < CallExpression",
    ]);
  });

  it("reaches type positions, which carry dependencies of their own", () => {
    expect(identifiers("let x: Box<Item>;")).toContain(
      "Item < Program < VariableDeclaration < VariableDeclarator < Identifier < TSTypeAnnotation < TSTypeReference < TSTypeParameterInstantiation < TSTypeReference"
    );
  });

  it("walks a chain deeper than the call stack, as a minified chunk is", () => {
    // 20,000 nested additions: a recursive walk overflows at about 5,000 here.
    const code = `export const x = a${" + a".repeat(20_000)};`;
    let identifiers = 0;
    walk(parseSource(code, "chunk.mjs").program, node => {
      if (node.type === "Identifier") identifiers++;
    });
    // `x` and the 20,001 operands.
    expect(identifiers).toBe(20_002);
  });

  it("skips a node's children when the visitor answers false", () => {
    const seen: string[] = [];
    let statements = 0;
    walk(parseSource("f(a, g(b)); h(c);", "probe.ts").program, node => {
      if (node.type === "Identifier") seen.push(node.name);
      // Everything under the first statement is skipped, the second is read.
      return !(node.type === "ExpressionStatement" && ++statements === 1);
    });
    expect(seen).toEqual(["h", "c"]);
  });
});

import { parseSync, visitorKeys } from "oxc-parser";

/**
 * Parse one JavaScript or TypeScript file, refusing a file the parser could not read.
 *
 * Every check in this repository that reads source does it through here. oxc
 * answers a syntax error with an EMPTY program plus a list of errors rather than
 * by throwing, so a check that looked only at the program would read a file it
 * never parsed as one containing nothing: no imports, no calls, no violations —
 * a clean green over a file that was never read. Refusing here makes that case
 * fail the run, once, for every caller.
 *
 * The language comes from `fileName`'s extension, so it is REQUIRED and must be
 * the file's real name: a `.tsx` file read as `.ts` parses `<div>` as a type
 * assertion, and a `.ts` angle-bracket assertion read as `.tsx` does not parse.
 *
 * Plain JavaScript, not TypeScript, so the repository's `.mjs` scripts can load
 * it on every Node version `engines` allows, without type stripping.
 */
export function parseSource(text, fileName) {
  const parsed = parseSync(fileName, text);
  if (parsed.errors.length > 0) {
    throw new Error(
      `${fileName} cannot be parsed, so nothing in it can be read: ${parsed.errors[0].message}`
    );
  }
  return parsed;
}

/**
 * The string a node spells out whole — a quoted string, or a template literal
 * with no substitutions — or null for anything computed.
 *
 * A substitution-free template is as statically known as a quoted string, so
 * a check that accepted only quotes would walk past a specifier written in
 * backticks.
 */
export function literalText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** A node's children, in source order. */
function childrenOf(node) {
  const children = [];
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    for (const each of Array.isArray(child) ? child : [child]) {
      if (each && typeof each.type === "string") children.push(each);
    }
  }
  return children;
}

/** Marks, on the walk's stack, the point where a node's children are all done. */
const EXIT = Symbol("exit");

/**
 * Visit `node` and everything under it in source order, each with the chain of
 * nodes above it, nearest last.
 *
 * oxc's nodes carry no parent links, and a check that asks what ENCLOSES a node
 * — the function it sits in, the call it is an argument of — needs one. Built
 * from oxc's own `visitorKeys`, so every child the parser defines is reached,
 * type annotations included. `visit` returning `false` skips that node's
 * children.
 *
 * Iterative, with an explicit stack: a minified chunk is one expression chain
 * thousands of levels deep, and a recursive walk exhausts the call stack on it
 * long before the parser, which reads it without trouble.
 */
export function walk(root, visit) {
  const ancestors = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === EXIT) {
      ancestors.pop();
      continue;
    }
    if (visit(node, ancestors) === false) continue;
    ancestors.push(node);
    stack.push(EXIT);
    // Children go on last-first, so they come off the stack in source order.
    stack.push(...childrenOf(node).reverse());
  }
}

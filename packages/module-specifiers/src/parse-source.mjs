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
 * Visit `node` and everything under it in source order, each with the chain of
 * nodes above it, nearest last.
 *
 * oxc's nodes carry no parent links, and a check that asks what ENCLOSES a node
 * — the function it sits in, the call it is an argument of — needs one. Built
 * from oxc's own `visitorKeys`, so every child the parser defines is reached,
 * type annotations included. `visit` returning `false` skips that node's
 * children.
 */
export function walk(node, visit, ancestors = []) {
  if (visit(node, ancestors) === false) return;
  ancestors.push(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key];
    for (const each of Array.isArray(child) ? child : [child]) {
      if (each && typeof each.type === "string") walk(each, visit, ancestors);
    }
  }
  ancestors.pop();
}

/**
 * Types for the css-tree subpath entry this package imports.
 *
 * `@types/css-tree` describes only the root entry, but the root pulls in
 * css-tree's MDN-backed reference data, which loads `node:module` and would
 * break the engine's promise to run in browsers and edge runtimes. The parser
 * and walker entries carry neither, so they are imported directly and typed
 * here against css-tree's own published types.
 */
declare module "css-tree/parser" {
  import type { CssNode, ParseOptions } from "css-tree";

  const parse: (source: string, options?: ParseOptions) => CssNode;
  export default parse;
}

declare module "css-tree/walker" {
  import type { CssNode, WalkOptions } from "css-tree";

  const walk: (ast: CssNode, options: WalkOptions) => void;
  export default walk;
}

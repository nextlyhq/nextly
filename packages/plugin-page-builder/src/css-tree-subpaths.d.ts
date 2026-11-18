/**
 * Types for the css-tree subpath entries this package imports where its code
 * also runs in the browser.
 *
 * `@types/css-tree` describes only the root entry, and the root pulls in
 * css-tree's MDN-backed reference data, which loads `node:module`. The parser
 * and walker entries carry neither, so code bundled for the admin imports them
 * directly, typed here against css-tree's own published types.
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

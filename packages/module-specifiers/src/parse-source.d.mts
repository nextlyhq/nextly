import type { Node, ParseResult } from "oxc-parser";

/** The types of `parse-source.mjs`, which documents the behaviour. */
export declare function parseSource(text: string, fileName: string): ParseResult;

export declare function walk(
  node: Node,
  visit: (node: Node, ancestors: readonly Node[]) => boolean | void
): void;

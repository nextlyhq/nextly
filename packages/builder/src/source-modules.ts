/**
 * Which files the bundler will follow, as one answer both guards ask.
 *
 * The layering guard and the geometry-ownership guard each walk `src` looking
 * for files to inspect, and each was written with its own copy of this pattern.
 * Two copies of "what counts as a source module" drift the moment TypeScript
 * grows an extension — and a guard that walks past a file reports clean about
 * code it never read, which is the failure mode both of them exist to prevent.
 *
 * `.mts` and `.cts` are here because TypeScript and tsup follow them. They were
 * missing from both copies, so a module written with either extension was
 * invisible to every check in this package.
 *
 * This module imports nothing on purpose. It is reached from test files, and a
 * shared helper that pulled in `node:fs` would put a Node import inside `src`
 * where the layering guard is entitled to refuse it.
 */
export const BUNDLED_MODULE = /\.(?:[cm]?tsx?|[cm]?jsx?)$/;

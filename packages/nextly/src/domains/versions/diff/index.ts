/**
 * Content version diffing: a pure, schema-driven engine that compares two
 * snapshots into a typed, UI-independent tree.
 *
 * @module domains/versions/diff
 */

export * from "./types";
export { computeVersionDiff } from "./compute-diff";
export type { ComputeDiffOptions, VersionDiffBody } from "./compute-diff";

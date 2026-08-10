/**
 * Types for the export-map derivation, which is plain ESM so a Node script and a Vitest suite can
 * both read it without a build step.
 */

/** One published entry point. */
export interface PublishedEntry {
  /** The export key, such as `.` or `./color`. */
  subpath: string;
  /** The built file's base name, such as `index` or `color`. */
  name: string;
  /** Whether it is importable from server code. */
  serverSafe: boolean;
}

/** Every published entry point that resolves to JavaScript. */
export function publishedEntries(): PublishedEntry[];

/** The built declaration files those entry points resolve to, in both module systems. */
export function declarationFiles(): string[];

/** The built JavaScript files that must not carry a `"use client"` banner. */
export function serverSafeArtifacts(): string[];

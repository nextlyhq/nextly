/**
 * Types for the export-map derivation, which is plain ESM so a Node script and a Vitest suite can
 * both read it without a build step.
 */

/** One published entry point. */
export interface PublishedEntry {
  /** The export key, such as `.` or `./color`. */
  subpath: string;
  /** The barrel it is built from, relative to the package root. */
  source: string;
  /** The build entry's key, such as `index` or `color`. */
  name: string;
  /** The declaration files it resolves to, ESM then CJS. */
  declarations: string[];
  /** The JavaScript files it resolves to, ESM then CJS. */
  artifacts: string[];
  /** Whether it is importable from server code. */
  serverSafe: boolean;
}

/** Every published entry point that resolves to JavaScript. */
export function publishedEntries(): PublishedEntry[];

/** The built declaration files those entry points resolve to, in both module systems. */
export function declarationFiles(): string[];

/** The built JavaScript files that must carry a `"use client"` banner. */
export function clientArtifacts(): string[];

/** The built JavaScript files that must not carry a `"use client"` banner. */
export function serverSafeArtifacts(): string[];

/** The build entries for the server-safe subpaths, as tsup expects them. */
export function serverSafeBuildEntries(): Record<string, string>;

/** Every subpath's source barrel, keyed by subpath. */
export function sourcesBySubpath(): Record<string, string>;

/** The build entry for the root barrel, as tsup expects it. */
export function rootBuildEntry(): string[];

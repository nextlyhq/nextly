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

/** A subpath's declared barrel, and which side of the React boundary it sits on. */
export interface DeclaredBarrel {
  /** The barrel it is built from, relative to the package root. */
  source: string;
  /** Whether it is client code, and so carries a `"use client"` banner. */
  client: boolean;
}

/**
 * The published entry points implied by an export map and a set of declared barrels.
 *
 * Takes both inputs rather than reading them, so the refusals can be exercised against a map this
 * package does not have yet.
 */
export function derivePublishedEntries(
  exportMap: Record<string, unknown>,
  sources: Record<string, DeclaredBarrel>
): PublishedEntry[];

/** Every published entry point that resolves to JavaScript, read from this package. */
export function publishedEntries(): PublishedEntry[];

/**
 * The built declaration files those entry points resolve to, in both module systems.
 *
 * Each helper below takes the entries it derives from, defaulting to this package's own, so a
 * caller can pass fixtures instead.
 */
export function declarationFiles(entries?: PublishedEntry[]): string[];

/** The built JavaScript files that must carry a `"use client"` banner. */
export function clientArtifacts(entries?: PublishedEntry[]): string[];

/** The built JavaScript files that must not carry a `"use client"` banner. */
export function serverSafeArtifacts(entries?: PublishedEntry[]): string[];

/** The build entries for the server-safe subpaths, as tsup expects them. */
export function serverSafeBuildEntries(
  entries?: PublishedEntry[]
): Record<string, string>;

/** Every subpath's source barrel, keyed by subpath. */
export function sourcesBySubpath(
  entries?: PublishedEntry[]
): Record<string, string>;

/** The build entries for the client subpaths, keyed by published artifact name. */
export function clientBuildEntries(
  entries?: PublishedEntry[]
): Record<string, string>;

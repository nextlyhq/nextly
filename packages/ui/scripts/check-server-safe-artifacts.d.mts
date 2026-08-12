/**
 * Types for the server-safe artifact gate, which is plain ESM so the build can run it as a script
 * and a Vitest suite can read its pure parts without a build step.
 */

/**
 * Every module specifier the built artifact still names, across both module formats.
 *
 * A specifier that is not a literal is returned as an `<unreadable specifier: ...>` marker rather
 * than dropped, so it fails an allow-list comparison instead of passing in silence.
 */
export function specifiersIn(source: string, fileName: string): string[];

/**
 * The package a specifier belongs to, or `null` when it names none — a relative path or a Node
 * builtin. A scoped name keeps both of its segments.
 */
export function packageOf(specifier: string): string | null;

/**
 * Every emitted file reachable from one artifact, following the relative specifiers between them.
 *
 * `read` returns the file's text, or null when it is absent. A split build puts an entry's
 * dependencies in a chunk beside it, so an entry alone does not name what it reaches.
 */
export function reachedFrom(
  entry: string,
  read: (file: string) => string | null
): Array<{ file: string; missing: boolean; specifiers: string[] }>;

/** The package an input path belongs to, or `null` when it is first-party source. */
export function packageOfInput(input: string): string | null;

/**
 * The packages BUNDLED into one artifact, read from the build's own record of its inputs.
 *
 * `null` when the metafile does not describe that artifact — a question left unanswered rather
 * than an empty result, since a bundled package leaves no import for the specifier scan to find.
 */
export function bundledPackages(
  metafile: {
    outputs?: Record<
      string,
      {
        inputs?: Record<string, unknown>;
        /** What the bundler RESOLVED without inlining; read for resolver-only dependencies. */
        imports?: readonly { path?: string; kind?: string }[];
      }
    >;
  },
  outputNames: string | string[]
): string[] | null;

/**
 * The distinct specifiers reachable from one artifact that name a package outside the allow-list,
 * plus any file the walk could not read.
 */
export function disallowedSpecifiers(
  entry: string,
  read: (file: string) => string | null,
  allowed: Set<string>
): { offending: string[]; missing: string[] };

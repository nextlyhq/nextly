/**
 * What a generator did to the project's files, for the run's report.
 *
 * Every generator that writes into an app the person already has returns this
 * shape, so the report can say, in one place and one way, what was written,
 * what was extended and what was left alone. Paths are relative to the project.
 * Nothing here ever holds a value from an env file: `added` names keys, package
 * names or what a block is for.
 */
export interface GeneratedFiles {
  /** Files that did not exist and were written. */
  written: string[];
  /** Files that existed and were extended, with what was added to each. */
  changed: { path: string; added: string[] }[];
  /**
   * Files that existed and were left exactly as they were, with why, and the
   * text to add by hand when the person needs it.
   */
  skipped: { path: string; why: string; toAdd?: string }[];
}

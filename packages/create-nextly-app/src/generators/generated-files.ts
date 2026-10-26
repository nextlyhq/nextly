/**
 * What a generator did to a project's files, so the scaffolder can tell the
 * developer exactly what it wrote, what it extended and what it left alone.
 * Entries name paths, keys and packages only, never a value: a report may be
 * printed, and a value can be a secret.
 */
export interface GeneratedFiles {
  /** Project-relative paths written new. */
  written: string[];
  /** Files that existed and were extended; `added` names keys, packages or lines' purpose, never a value. */
  changed: { path: string; added: string[] }[];
  /** Files that existed and were left exactly as they were; `toAdd` holds text to add by hand, when there is some. */
  skipped: { path: string; why: string; toAdd?: string }[];
  /** What the developer should know about a change that was not theirs to expect, such as a setting turned off. */
  notices?: string[];
}

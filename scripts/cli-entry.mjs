/**
 * Whether the calling module is the file node was asked to run.
 *
 * Scripts here are both importable and runnable: a test imports the module for
 * its exports, and a contributor runs the same file from a package script. The
 * guard is what separates those, and when it is wrong the module simply does
 * not run — the process exits 0 having done nothing, which is byte-identical to
 * a clean pass. That is why this is shared rather than rewritten per script.
 *
 * Comparing `import.meta.url` against an interpolated `file://${argv[1]}` looks
 * equivalent and is not, in two independent ways:
 *
 * - On Windows `argv[1]` is a drive path (`C:\repo\x.mjs`), so interpolation
 *   yields `file://C:\repo\x.mjs` while `import.meta.url` is
 *   `file:///C:/repo/x.mjs`. Two slashes against three, backslashes against
 *   forward: the comparison is false for every script, on every run.
 * - A path containing a space, `#` or `?` needs percent-encoding that only URL
 *   construction performs.
 *
 * BOTH candidate forms are compared, because which one matches depends on a
 * runtime flag this code cannot see. By default the runtime resolves symlinks
 * in `import.meta.url` while leaving `argv[1]` raw, so the raw form misses.
 * Under `--preserve-symlinks-main` — settable through `NODE_OPTIONS`, from
 * outside the command line — the link survives in `import.meta.url` and it is
 * the RESOLVED form that misses. Accepting either depends on neither.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The entry path with symlinks resolved, or undefined when it cannot be.
 *
 * Undefined rather than a throw: an unresolvable entry leaves the raw form
 * above still able to match, so failing here would reject a valid invocation.
 *
 * @param {string} entry
 * @returns {string | undefined}
 */
function resolvedEntry(entry) {
  try {
    return realpathSync(entry);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} moduleUrl The caller's own `import.meta.url`.
 * @returns {boolean} True when node was asked to run that module directly.
 */
export function isCliEntry(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;

  for (const candidate of [entry, resolvedEntry(entry)]) {
    if (candidate === undefined) continue;
    try {
      if (pathToFileURL(candidate).href === moduleUrl) return true;
    } catch {
      // A path that cannot be expressed as a file URL is not this module, and
      // is not a reason to refuse the other candidate.
    }
  }
  return false;
}

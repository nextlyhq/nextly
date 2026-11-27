import { randomBytes } from "crypto";

import { classifyError, type ClassifyScope } from "../classify-error.js";

import type { COUNT_RANGES, INSTALL_ERROR_CODES } from "./catalog.js";
import { PAGE_LABELS, USAGE_EVENTS } from "./catalog.js";

// Turning what a surface knows into catalog values. Each takes the raw thing
// (a typed label, a count, a list of package names, an error) and returns
// only a value the catalog lists, so the raw thing never reaches an event.

type PageLabel = (typeof PAGE_LABELS)[number];
type CountRange = (typeof COUNT_RANGES)[number];
type InstallErrorCode = (typeof INSTALL_ERROR_CODES)[number];

/** A new random 128-bit id, as 32 lowercase hex characters. */
export function newRandomId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * The page label for `create-nextly-app --from <label>`: the label when it
 * names a page on the list, `none` when none was given, `other` for anything
 * else (a mistyped label, a URL, an email address).
 */
export function pageLabelFrom(raw: string | undefined): PageLabel {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") return "none";
  const found = PAGE_LABELS.find(
    label => label === value && label !== "none" && label !== "other"
  );
  return found ?? "other";
}

/** A count as the range a daily summary sends, never the exact number. */
export function countRange(count: number): CountRange {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count <= 10) return "1-10";
  if (count <= 100) return "11-100";
  if (count <= 1000) return "101-1000";
  if (count <= 10_000) return "1001-10000";
  return "more";
}

// The catalog's own pattern for an official plugin, so what is counted as one
// here is exactly what the sender accepts.
const OFFICIAL_PLUGIN = new RegExp(
  USAGE_EVENTS.daily_summary.required.plugins_official.pattern
);

/**
 * The plugins a site has on, as a summary sends them: Nextly's own plugins by
 * package name, every other plugin only counted, so a private plugin's name
 * never leaves the site.
 */
export function pluginsOn(packageNames: readonly string[]): {
  plugins_official: string[];
  plugins_other: number;
} {
  const unique = [...new Set(packageNames)];
  const official = unique.filter(name => OFFICIAL_PLUGIN.test(name)).sort();
  return {
    plugins_official: official,
    plugins_other: unique.length - official.length,
  };
}

/**
 * The installer's fixed error code for a failure. Reads only the error's
 * system code (`ENOSPC`, `EACCES`, ...), never its message or stack.
 */
export function installErrorCode(
  error: unknown,
  scope: ClassifyScope
): InstallErrorCode {
  return classifyError(error, scope);
}

/** The major version of a Node.js version string ("24.21.0" gives 24). */
export function nodeMajor(version: string): number {
  const major = Number.parseInt(version, 10);
  return Number.isInteger(major) && major >= 0 && major <= 999 ? major : 0;
}

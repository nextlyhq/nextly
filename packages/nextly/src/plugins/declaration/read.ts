/**
 * Reading a plugin package's declaration from its package.json, as data: no
 * code of the plugin's runs, so the declaration can be read before the
 * package is installed and from what the registry serves for one version.
 *
 * @module plugins/declaration/read
 */
import type { z } from "zod";

import {
  PLUGIN_PACKAGE_DECLARATION_FORMAT,
  PLUGIN_PACKAGE_DECLARATION_SCHEMA,
  PLUGIN_REGISTRATION_SCHEMA,
  type PluginPackageDeclaration,
  type PluginPackageRegistration,
} from "./format";

/**
 * @experimental What a package.json says under `nextly`:
 *
 * - `none`: nothing a plugin declares.
 * - `registration`: today's `nextly.plugin` block with no format, read as it
 *   always was, so such a package is added as it was before the format.
 * - `declared`: a declaration in a format this Nextly reads.
 * - `newer-format`: a declaration in a format this Nextly does not read yet,
 *   with the Nextly versions it says it works with when that much can be read.
 * - `invalid`: a declaration that does not parse, with each problem, and
 *   whether it was today's registration block alone (`registration`) or a
 *   declaration with a format (`declaration`).
 */
export type PluginPackageDeclarationReading =
  | { kind: "none" }
  | { kind: "registration"; registration: PluginPackageRegistration }
  | { kind: "declared"; declaration: PluginPackageDeclaration }
  | { kind: "newer-format"; format: number; core?: string }
  | {
      kind: "invalid";
      of: "registration" | "declaration";
      problems: string[];
    };

/** Each issue of a failed parse as `path: message`, the path from the `nextly` key. */
function problemsOf(error: z.ZodError, under: string): string[] {
  return error.issues.map(issue => {
    const path = [under, ...issue.path.map(String)].join(".");
    return `${path}: ${issue.message}`;
  });
}

/** Whether `value` is a plain object, as JSON parses one. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @experimental A package's declaration, read from its package.json as
 * parsed JSON. Never throws: what cannot be read is returned as `invalid`, and
 * a format newer than this Nextly reads as `newer-format`, so each caller
 * refuses in its own words.
 */
export function readPluginPackageDeclaration(
  manifest: unknown
): PluginPackageDeclarationReading {
  const nextly = isObject(manifest) ? manifest.nextly : undefined;
  if (!isObject(nextly)) return { kind: "none" };

  // Before the format had a number, `nextly.plugin` was all a package said,
  // and anything else under `nextly` was not read. That stays so: only a
  // declaration that names its format is held to the format.
  if (!("format" in nextly)) {
    if (nextly.plugin === undefined) return { kind: "none" };
    const parsed = PLUGIN_REGISTRATION_SCHEMA.safeParse(nextly.plugin);
    return parsed.success
      ? { kind: "registration", registration: parsed.data }
      : {
          kind: "invalid",
          of: "registration",
          problems: problemsOf(parsed.error, "nextly.plugin"),
        };
  }

  const format = nextly.format;
  if (
    typeof format === "number" &&
    Number.isInteger(format) &&
    format > PLUGIN_PACKAGE_DECLARATION_FORMAT
  ) {
    // Only the Nextly range is read from a newer format, to say which
    // release reads it; nothing else in it is trusted to mean what format 1
    // means.
    const core =
      typeof nextly.core === "string" && nextly.core.trim() !== ""
        ? nextly.core.trim()
        : undefined;
    return core === undefined
      ? { kind: "newer-format", format }
      : { kind: "newer-format", format, core };
  }

  const parsed = PLUGIN_PACKAGE_DECLARATION_SCHEMA.safeParse(nextly);
  return parsed.success
    ? { kind: "declared", declaration: parsed.data }
    : {
        kind: "invalid",
        of: "declaration",
        problems: problemsOf(parsed.error, "nextly"),
      };
}

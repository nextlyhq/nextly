/**
 * The check a plugin's own test suite runs, so a plugin cannot be published
 * with a declaration that disagrees with its code.
 *
 * @module plugins/declaration/check
 */
import type { PluginDefinition } from "../plugin-context";

import { comparePluginPackageDeclaration } from "./compare";
import {
  PLUGIN_PACKAGE_DECLARATION_FORMAT,
  type PluginDatabaseKind,
  type PluginPackageRegistration,
} from "./format";
import { newerFormatMessage } from "./newer-format";
import { readPluginPackageDeclaration } from "./read";
import { registrationTargetProblem } from "./registration-target";

/** @experimental What a suite knows beyond the manifest and the definition. */
export interface CheckPluginPackageDeclarationOptions {
  /**
   * The databases the suite runs the plugin on, such as
   * `getConfiguredTestDialects()`. Each must be among the declared databases:
   * a suite that proves the plugin on a database it does not declare has
   * found a declaration that undersells it, or a suite testing what the
   * plugin does not support.
   */
  databases?: readonly PluginDatabaseKind[];
  /**
   * The package's entry, as `import * as entry from "./index"` gives it.
   * With it, the declaration's registration is checked against what the
   * entry exports, as `nextly plugins add` will place it: the export is
   * there, it is a function when it is called, and otherwise it is the
   * definition this check was given.
   */
  exports?: Readonly<Record<string, unknown>>;
}

/**
 * @experimental Every problem with a plugin package's declaration, checked
 * against the plugin's own definition: a declaration missing or unreadable,
 * in a format this Nextly does not read, or saying something the definition
 * does not. Empty when the two agree, so a suite asserts it is empty:
 *
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { checkPluginPackageDeclaration } from "@nextlyhq/plugin-sdk";
 *
 * import * as entry from "./index";
 * import { myPlugin } from "./index";
 *
 * const manifest = JSON.parse(
 *   readFileSync(new URL("../package.json", import.meta.url), "utf8")
 * );
 * expect(
 *   checkPluginPackageDeclaration(manifest, myPlugin(), { exports: entry })
 * ).toEqual([]);
 * ```
 */
export function checkPluginPackageDeclaration(
  manifest: unknown,
  definition: PluginDefinition,
  options: CheckPluginPackageDeclarationOptions = {}
): string[] {
  const reading = readPluginPackageDeclaration(manifest);
  switch (reading.kind) {
    case "none":
    case "registration":
      return [
        `The package.json has no declaration: its \`nextly\` key needs a \`format\` (${PLUGIN_PACKAGE_DECLARATION_FORMAT}), the Nextly versions as \`core\`, and the \`databases\` the plugin works with.`,
      ];
    case "newer-format":
      return [newerFormatMessage(reading.format, reading.core)];
    case "invalid":
      return reading.problems.map(
        problem => `The declaration does not parse: ${problem}.`
      );
    case "declared":
      break;
  }

  const { declaration } = reading;
  const unlisted = (options.databases ?? []).filter(
    database => !declaration.databases.includes(database)
  );
  return [
    ...comparePluginPackageDeclaration(declaration, definition).map(
      difference => difference.message
    ),
    ...unlisted.map(
      database =>
        `The suite runs the plugin on ${database}, and the declaration's databases do not list it.`
    ),
    ...registrationProblems(declaration.plugin, definition, options.exports),
  ];
}

/**
 * What stops the registration placing this plugin from the entry's exports:
 * none without the exports or a registration to check.
 */
function registrationProblems(
  registration: PluginPackageRegistration | undefined,
  definition: PluginDefinition,
  exports: Readonly<Record<string, unknown>> | undefined
): string[] {
  if (registration === undefined || exports === undefined) return [];
  const problem = registrationTargetProblem(registration, exports);
  if (problem !== undefined) {
    return [
      `The declaration's registration does not fit the package's entry. ${problem}.`,
    ];
  }
  // Placed as it is, the export must be the plugin itself. A factory's
  // result is a new object each call, so only an export used as it is can
  // be compared with the definition by identity.
  if (
    registration.call !== true &&
    exports[registration.export] !== definition
  ) {
    return [
      `The declaration's registration places ${registration.export} as it is, and the entry's ${registration.export} is not the plugin this check was given: declare "call": true if it is a function that makes the plugin.`,
    ];
  }
  return [];
}

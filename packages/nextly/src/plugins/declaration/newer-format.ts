/**
 * The one wording for a declaration in a format this Nextly does not read,
 * shared by `nextly plugins add`'s refusal and a plugin suite's check.
 *
 * @module plugins/declaration/newer-format
 */

import { PLUGIN_PACKAGE_DECLARATION_FORMAT } from "./format-version";

/**
 * The sentence saying a declaration's format is newer than this Nextly reads,
 * and which Nextly reads it: the one the declaration says the plugin works
 * with, when it says.
 */
export function newerFormatMessage(format: number, core?: string): string {
  const said = `The declaration is in format ${format}, and this Nextly reads formats up to ${PLUGIN_PACKAGE_DECLARATION_FORMAT}: this format needs a newer Nextly`;
  // The release that reads a newer format is not known to this one; the
  // Nextly versions the plugin says it works with are, when it says them.
  return core === undefined
    ? `${said}.`
    : `${said}, and the plugin says it works with Nextly "${core}".`;
}

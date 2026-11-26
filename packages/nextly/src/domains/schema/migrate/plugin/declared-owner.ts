/**
 * Which registry rows the configuration's declaration of a Single or a field
 * group takes from another owner. Collections answer it in their own registry,
 * where a row can also be one a demote handed to the Schema Builder.
 *
 * @module domains/schema/migrate/plugin/declared-owner
 */

import { isConfigOwnedSource } from "../../../webhooks/recording-provenance";

/**
 * Whether a declaration by `declared` (`code` or `plugin:<name>`) takes a row
 * that records another owner: one code or a plugin owns takes the
 * declaration's, so a plugin's row an earlier release recorded as the app's own
 * is the plugin's again, and the other way round. A row made in the Schema
 * Builder, or Nextly's own, keeps its owner.
 */
export function declarationTakesRow(
  declared: string,
  recorded: { source?: string | null }
): boolean {
  return (
    isConfigOwnedSource(declared) &&
    recorded.source !== declared &&
    isConfigOwnedSource(recorded.source)
  );
}

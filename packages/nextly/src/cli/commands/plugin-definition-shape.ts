/**
 * Telling a plugin definition apart from anything else a module exports, by
 * the fields every one carries, for the commands that read a plugin from a
 * module they did not write: `migrate:create --plugin` and `plugins add`.
 *
 * @module cli/commands/plugin-definition-shape
 */
import type { PluginDefinition } from "../../plugins/plugin-context";

/**
 * Whether `value` is a plugin definition. `name` alone is not enough: a
 * `defineTable` result carries a name too. `version` is required of every
 * plugin and of no table.
 */
export function isPluginDefinition(
  value: unknown
): value is Partial<PluginDefinition> & { name: string; version: string } {
  const candidate = value as { name?: unknown; version?: unknown } | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string"
  );
}

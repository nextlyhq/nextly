/**
 * The icon a new entity is offered from its name, until the person picks one.
 *
 * @module lib/builder/icon-suggestion
 */

/** The icon offered when nothing in the name suggests one. */
export const DEFAULT_ENTITY_ICON = "FileText";

export function suggestIcon(_name: string): string {
  return DEFAULT_ENTITY_ICON;
}

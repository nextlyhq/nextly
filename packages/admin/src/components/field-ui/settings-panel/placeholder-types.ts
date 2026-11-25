/**
 * Which field types show a placeholder in the settings panel's Display tab: one answer for the tab
 * and for a type change, which keeps a placeholder only where the new type shows one.
 *
 * @module components/field-ui/settings-panel/placeholder-types
 */
import type { FieldSurface } from "nextly/field-catalog";

import { isSurfaceBuiltInType } from "@admin/lib/builder/field-type-label";

/**
 * The types whose input shows a placeholder. A dropdown's placeholder is one
 * of its own settings, beside its options, so it is not listed here.
 */
const TYPES_WITH_PLACEHOLDER = new Set([
  "text",
  "textarea",
  "richText",
  "email",
  "password",
  "number",
  "code",
]);

/**
 * The text-like inputs some surfaces build in (forms and user fields). They
 * show a placeholder only where the surface builds them in: elsewhere the same
 * id is a plugin's, whose own settings decide what it has.
 */
const SURFACE_TYPES_WITH_PLACEHOLDER = new Set(["url", "phone"]);

/** Whether the field's input on this surface shows a placeholder. */
export function hasPlaceholder(surface: FieldSurface, type: string): boolean {
  if (TYPES_WITH_PLACEHOLDER.has(type)) return true;
  return (
    SURFACE_TYPES_WITH_PLACEHOLDER.has(type) &&
    isSurfaceBuiltInType(surface, type)
  );
}

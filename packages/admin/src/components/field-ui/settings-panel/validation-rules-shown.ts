/**
 * The validation rules the settings panel's Validation tab offers for a type: core's rules for the
 * type (`validationRulesForFieldType`), a plugin's type taking those of the built-in type its
 * declared storage behaves as, narrowed by the surface. One answer for the tab and for a type
 * change, which keeps a rule's value only where the new type offers the rule.
 *
 * @module components/field-ui/settings-panel/validation-rules-shown
 */
import {
  validationRulesForFieldType,
  type FieldSurface,
  type FieldValidationRule,
} from "nextly/field-catalog";

import { isSurfaceBuiltInType } from "@admin/lib/builder/field-type-label";
import { pluginFieldTypeStorage } from "@admin/lib/builder/plugin-field-type-entries";
import type { PluginMetadata } from "@admin/types/branding";

/** A surface's narrowing of the rules core allows for a type (`FieldSettingsSurface.validationRules`). */
export type ValidationNarrowing = (
  type: string,
  allowed: readonly FieldValidationRule[]
) => readonly FieldValidationRule[];

export function validationRulesShown(args: {
  surface: FieldSurface;
  type: string;
  /** The installed plugins, whose types declare the storage they behave as. */
  plugins: readonly PluginMetadata[] | undefined;
  narrow?: ValidationNarrowing;
}): readonly FieldValidationRule[] {
  // A type this surface builds in answers from its own storage, even when a
  // plugin declares the same id for another surface.
  const coreAllowed = validationRulesForFieldType(
    args.type,
    isSurfaceBuiltInType(args.surface, args.type)
      ? undefined
      : pluginFieldTypeStorage(args.plugins, args.type)
  );
  // Narrowed, never widened: a surface can only take away rules core allows,
  // so a rule the type cannot hold is never offered whatever it returns.
  const narrowed = args.narrow?.(args.type, coreAllowed);
  return narrowed
    ? coreAllowed.filter(rule => narrowed.includes(rule))
    : coreAllowed;
}

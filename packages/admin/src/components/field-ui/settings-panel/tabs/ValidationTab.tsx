// Which rules a field type accepts is decided by `FIELD_TYPE_VALIDATION_RULES`
// in core, not by lists kept here. A list of type names cannot see a type it
// was not written to know about, so a plugin-contributed type used to fall
// through every branch and be offered nothing; it now inherits the rules of the
// built-in type its declared storage primitive behaves as.
//
// The controls themselves are the kit's, shared with the form builder's field
// editor, which drew the same set independently. What stays here is the part
// that is genuinely this surface's: resolving the allowed set from the plugin
// registry, and mapping the builder's own storage.
import {
  validationRulesForFieldType,
  type FieldSurface,
  type FieldValidationRule,
} from "nextly/field-catalog";
import type { JSX } from "react";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { isSurfaceBuiltInType } from "@admin/lib/builder/field-type-label";
import { pluginFieldTypeStorage } from "@admin/lib/builder/plugin-field-type-entries";

import {
  drawsAnyValidationRule,
  ValidationRulesEditor,
} from "../../ValidationRulesEditor";

type Props = {
  /** The surface the panel is on, which decides who owns a type's id. */
  surface: FieldSurface;
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
  /** The surface's narrowing of the rules core allows for the type. */
  narrow?: (
    type: string,
    allowed: readonly FieldValidationRule[]
  ) => readonly FieldValidationRule[];
};

export function ValidationTab({
  surface,
  field,
  readOnly = false,
  onChange,
  narrow,
}: Props): JSX.Element {
  const branding = useBranding();
  const validation = field.validation ?? {};

  // This surface stores the rules under the names core uses, so the kit's
  // values pass through unmapped. The form builder does not, and maps at its
  // own call site rather than here.
  // A type this surface builds in answers from its own storage, even when a
  // plugin declares the same id for another surface.
  const coreAllowed = validationRulesForFieldType(
    field.type,
    isSurfaceBuiltInType(surface, field.type)
      ? undefined
      : pluginFieldTypeStorage(branding.plugins, field.type)
  );
  // Narrowed, never widened: a surface can only take away rules core allows,
  // so a rule the type cannot hold is never offered whatever it returns.
  const narrowed = narrow?.(field.type, coreAllowed);
  const allowed = narrowed
    ? coreAllowed.filter(rule => narrowed.includes(rule))
    : coreAllowed;

  // A type that takes none of the rules drawn here (a link, a group) says so,
  // rather than leaving the tab blank: Required is in General for every type.
  if (!drawsAnyValidationRule(allowed)) {
    return (
      <p className="text-sm text-muted-foreground">
        This type has no validation rules besides Required, which is in General.
      </p>
    );
  }

  return (
    <ValidationRulesEditor
      allowed={allowed}
      // Only where a Pattern is actually offered. Core hands the same message
      // to other failures too — `applyNumberBounds` uses it for min and max —
      // so on a field with no Pattern control the specific wording would name
      // a constraint the author cannot see and did not write the copy for.
      messageDescribes={allowed.includes("pattern") ? "pattern" : "validation"}
      value={validation}
      disabled={readOnly}
      onChange={next =>
        onChange({ ...field, validation: { ...validation, ...next } })
      }
    />
  );
}

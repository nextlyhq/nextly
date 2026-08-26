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
import { validationRulesForFieldType } from "nextly/field-catalog";

import { ValidationRulesEditor } from "@admin/components/field-ui";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { pluginFieldTypeStorage } from "@admin/lib/builder/plugin-field-type-entries";

import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function ValidationTab({ field, readOnly = false, onChange }: Props) {
  const branding = useBranding();
  const validation = field.validation ?? {};

  // This surface stores the rules under the names core uses, so the kit's
  // values pass through unmapped. The form builder does not, and maps at its
  // own call site rather than here.
  return (
    <ValidationRulesEditor
      allowed={validationRulesForFieldType(
        field.type,
        pluginFieldTypeStorage(branding.plugins, field.type)
      )}
      value={validation}
      disabled={readOnly}
      onChange={next =>
        onChange({ ...field, validation: { ...validation, ...next } })
      }
    />
  );
}

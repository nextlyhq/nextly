/**
 * A field type's own settings, wherever they are declared: a built-in type's
 * from the core table, any other type's from the settings its plugin declared.
 * The one lookup the settings panel uses, so a type's settings are found the
 * same way whichever surface the panel is on.
 */
import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { pluginFieldTypeSettings } from "@admin/lib/builder/plugin-field-type-entries";

import { coreFieldTypeSettings } from "./core-type-settings";
import { declaredTypeSettings } from "./DeclaredTypeSettings";
import type { FieldTypeSettings } from "./types";

/**
 * The type's settings, or `undefined` for a type with none of its own. A
 * plugin's are made once per declared list, so the controls keep their
 * identity while a person types.
 */
export function useFieldTypeSettings(
  type: string
): FieldTypeSettings | undefined {
  const declared = pluginFieldTypeSettings(useBranding().plugins, type);
  const fromPlugin = useMemo(
    () => (declared ? declaredTypeSettings(declared) : undefined),
    [declared]
  );
  return coreFieldTypeSettings(type) ?? fromPlugin;
}

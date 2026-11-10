/**
 * A field type's own settings, wherever they are declared: a built-in type's
 * from the core table, any other type's from the settings its plugin declared.
 * The one lookup the settings panel uses, so a type's settings are found the
 * same way whichever surface the panel is on.
 */
import { useMemo } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { pluginFieldTypeSettings } from "@admin/lib/builder/plugin-field-type-entries";

import { coreFieldTypeSettings } from "./core-type-settings";
import { declaredTypeSettings } from "./DeclaredTypeSettings";
import type { FieldTypeSettings } from "./types";

/**
 * What is known of a type's settings. A plugin's type is only known once the
 * plugin list has arrived: until then (`loading`), or when it never could
 * (`unavailable`), a type missing from the list proves nothing, so the panel
 * must not say the type has no settings of its own.
 */
export type FieldTypeSettingsLookup =
  | { status: "known"; settings: FieldTypeSettings | undefined }
  | { status: "loading" }
  | { status: "unavailable"; retry: () => void };

/**
 * The type's settings. A plugin's are made once per declared list, so the
 * controls keep their identity while a person types.
 */
export function useFieldTypeSettings(
  type: string,
  // The surface's own settings by type, which win over the core table's.
  surfaceTypes?: Readonly<Partial<Record<string, FieldTypeSettings>>>
): FieldTypeSettingsLookup {
  const declared = pluginFieldTypeSettings(useBranding().plugins, type);
  const { isPending, isUnavailable, retry } = useBrandingStatus();
  const fromPlugin = useMemo(
    () => (declared ? declaredTypeSettings(declared) : undefined),
    [declared]
  );

  const own = surfaceTypes?.[type];
  if (own) return { status: "known", settings: own };
  const core = coreFieldTypeSettings(type);
  if (core) return { status: "known", settings: core };
  if (fromPlugin) return { status: "known", settings: fromPlugin };
  if (isPending) return { status: "loading" };
  if (isUnavailable) return { status: "unavailable", retry };
  return { status: "known", settings: undefined };
}

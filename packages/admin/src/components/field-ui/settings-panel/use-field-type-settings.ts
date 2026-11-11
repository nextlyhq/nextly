/**
 * A field type's own settings, wherever they are declared: the surface's own
 * first, then a built-in type's from the core table, then a type the surface's
 * own catalog lists (a form's URL or file upload, which have none), and any
 * other type's from the settings its plugin declared. The one lookup the
 * settings panel uses, so a type's settings are found the same way whichever
 * surface the panel is on.
 */
import { useMemo } from "react";

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { isSurfaceBuiltInType } from "@admin/lib/builder/field-type-label";
import { pluginFieldTypeSettings } from "@admin/lib/builder/plugin-field-type-entries";

import { coreFieldTypeSettings } from "./core-type-settings";
import { declaredTypeSettings } from "./DeclaredTypeSettings";
import type { FieldSettingsSurface, FieldTypeSettings } from "./types";

/**
 * What is known of a type's settings. A plugin's type is only known once the
 * plugin list has arrived: until then (`loading`), or when it never could
 * (`unavailable`), a type missing from the list proves nothing, so the panel
 * must not say the type has no settings of its own.
 */
export type FieldTypeSettingsLookup =
  | { status: "known"; settings: FieldTypeSettings | undefined }
  // A plugin's type whose declared settings this surface cannot store.
  | { status: "withheld" }
  | { status: "loading" }
  | { status: "unavailable"; retry: () => void };

/**
 * The type's settings. A plugin's are made once per declared list, so the
 * controls keep their identity while a person types.
 */
export function useFieldTypeSettings(
  type: string,
  // The surface asked about: its own settings by type win over the core
  // table's, and its catalog's built-in types are known without a plugin.
  surface: Pick<
    FieldSettingsSurface,
    "surface" | "typeSettings" | "pluginSettings"
  >
): FieldTypeSettingsLookup {
  const declared = pluginFieldTypeSettings(useBranding().plugins, type);
  const { isPending, isUnavailable, retry } = useBrandingStatus();
  const fromPlugin = useMemo(
    () => (declared ? declaredTypeSettings(declared) : undefined),
    [declared]
  );

  const own = ownEntry(surface.typeSettings, type);
  if (own) return { status: "known", settings: own };
  const core = coreFieldTypeSettings(type);
  if (core) return { status: "known", settings: core };
  if (isSurfaceBuiltInType(surface.surface, type))
    return { status: "known", settings: {} };
  if (fromPlugin) {
    return surface.pluginSettings === false
      ? { status: "withheld" }
      : { status: "known", settings: fromPlugin };
  }
  if (isPending) return { status: "loading" };
  if (isUnavailable) return { status: "unavailable", retry };
  return { status: "known", settings: undefined };
}

/**
 * The surface's settings for the type, only when the surface names it: a type
 * spelled like an inherited member (`toString`) is not one the surface set.
 */
function ownEntry(
  table: FieldSettingsSurface["typeSettings"],
  type: string
): FieldTypeSettings | undefined {
  return table && Object.prototype.hasOwnProperty.call(table, type)
    ? table[type]
    : undefined;
}

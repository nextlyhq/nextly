"use client";

/**
 * Schema-builder "Use Page Builder" toggle. Shown ONLY when the page-builder plugin is
 * installed (via branding). Turning it on appends the editor-choice fields (`editorMode` +
 * a `page-builder` `content` field) to the builder's field list; off removes them. The fields
 * persist through the normal `fields` save path — no extra collection metadata.
 */
import { Label, Switch } from "@nextlyhq/ui";

import { useBranding } from "@admin/context/providers/BrandingProvider";

import {
  addPageBuilderFields,
  hasPageBuilderFields,
  removePageBuilderFields,
  type BuilderFieldLike,
} from "./pageBuilderToggle.helpers";

const PLUGIN_NAME = "@nextlyhq/plugin-page-builder";

export function PageBuilderToggle<T extends BuilderFieldLike>({
  fields,
  setFields,
  disabled,
}: {
  fields: T[];
  setFields: (fields: T[]) => void;
  disabled?: boolean;
}) {
  const branding = useBranding();
  const plugin = (branding.plugins ?? []).find(p => p.name === PLUGIN_NAME);
  if (!plugin) return null;

  // The canvas field renders via the plugin's registered editor component (discovered from
  // the plugin's field-type metadata), stored as a plain `json` field so the manifest is happy.
  const componentPath = plugin.fieldTypes?.find(
    ft => ft.type === "page-builder"
  )?.component;

  const on = hasPageBuilderFields(fields);
  return (
    <div className="flex items-center gap-3 py-2">
      <Switch
        checked={on}
        disabled={disabled}
        aria-label="Use Page Builder"
        onCheckedChange={next =>
          setFields(
            next
              ? addPageBuilderFields(fields, componentPath)
              : removePageBuilderFields(fields)
          )
        }
      />
      <Label className="cursor-pointer">Use Page Builder</Label>
      <span className="text-xs text-muted-foreground">
        Let entries choose a visual Page Builder canvas instead of the fields.
      </span>
    </div>
  );
}

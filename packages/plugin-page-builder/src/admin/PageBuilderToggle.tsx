"use client";

/**
 * Schema-builder "Use Page Builder" toggle, contributed via
 * `contributes.admin.schemaBuilderSlot`. The admin renders it (generically, via
 * `SchemaBuilderSlots`) above the field list in the collection/single builders
 * and passes `{ fields, setFields, disabled, context }`.
 *
 * Turning it on appends the editor-choice fields — an `editormode` select + a
 * reserved `content` field of the plugin's first-class `page-builder` type
 * (shown only in builder mode). The UI builder normalizes field names to
 * lowercase and strips `admin.component`, so the canvas field is identified by
 * its `type` (not a component path) and renders via the plugin's registered
 * field-type → component mapping. Off removes both. Idempotent.
 */
import { Label, Switch } from "@nextlyhq/ui";

import {
  EDITOR_MODE_FIELD,
  PAGE_BUILDER_CONTENT_FIELD,
  PAGE_BUILDER_TYPE,
} from "../collections/pageBuilderEntry";

interface BuilderField {
  id?: string;
  name?: string;
  type?: string;
  admin?: { component?: string } | null;
}

/** The canvas field — the first-class `page-builder` type, or the legacy json +
 *  plugin-editor component form (defensive; UI-created uses the type). */
function isCanvasField(f: BuilderField): boolean {
  if (f.type === PAGE_BUILDER_TYPE) return true;
  const component = f.admin?.component;
  return (
    typeof component === "string" && component.includes("plugin-page-builder")
  );
}

function hasPageBuilderFields(fields: BuilderField[]): boolean {
  return (
    fields.some(f => f.name === EDITOR_MODE_FIELD) && fields.some(isCanvasField)
  );
}

function addPageBuilderFields<T extends BuilderField>(fields: T[]): T[] {
  if (hasPageBuilderFields(fields)) return fields;
  const editormode = {
    id: "pb-editormode",
    name: EDITOR_MODE_FIELD,
    label: "Editor",
    type: "select",
    validation: {},
    defaultValue: "default",
    options: [
      { value: "default", label: "Default" },
      { value: "builder", label: "Page Builder" },
    ],
  } as unknown as T;
  const content = {
    id: "pb-content",
    name: PAGE_BUILDER_CONTENT_FIELD,
    label: "Page Builder",
    type: PAGE_BUILDER_TYPE,
    validation: {},
    admin: { condition: { field: EDITOR_MODE_FIELD, equals: "builder" } },
  } as unknown as T;
  return [...fields, editormode, content];
}

function removePageBuilderFields<T extends BuilderField>(fields: T[]): T[] {
  return fields.filter(f => f.name !== EDITOR_MODE_FIELD && !isCanvasField(f));
}

export interface PageBuilderToggleProps<T extends BuilderField> {
  fields: T[];
  setFields: (fields: T[]) => void;
  disabled?: boolean;
  context?: "collection" | "single";
}

export function PageBuilderToggle<T extends BuilderField>({
  fields,
  setFields,
  disabled,
}: PageBuilderToggleProps<T>) {
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
              ? addPageBuilderFields(fields)
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

/**
 * Pure add/remove of the Page Builder editor-choice fields for the schema builder's field
 * list. Enabling appends an `editormode` select + a reserved `content` canvas field — a
 * `json` field wired to the plugin's editor via `admin.component` (NOT a custom field type,
 * so it round-trips through `ui-schema.json` cleanly). Disabling removes both. Idempotent.
 */

/** Fallback component path if the plugin's field type isn't discoverable from branding. */
export const PAGE_BUILDER_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderField";

export interface BuilderFieldLike {
  id: string;
  name?: string;
  type?: string;
  label?: string;
  validation?: unknown;
  admin?: unknown;
  options?: unknown;
  defaultValue?: unknown;
}

function isCanvasField(f: BuilderFieldLike): boolean {
  if (f.type === "page-builder") return true;
  const component = (f.admin as { component?: string } | null | undefined)
    ?.component;
  return (
    typeof component === "string" && component.includes("plugin-page-builder")
  );
}

export function hasPageBuilderFields(fields: BuilderFieldLike[]): boolean {
  return (
    fields.some(f => f.name === "editormode") && fields.some(isCanvasField)
  );
}

export function addPageBuilderFields<T extends BuilderFieldLike>(
  fields: T[],
  componentPath: string = PAGE_BUILDER_COMPONENT
): T[] {
  if (hasPageBuilderFields(fields)) return fields;
  const editormode = {
    id: "pb-editormode",
    name: "editormode",
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
    name: "content",
    label: "Page Builder",
    type: "json",
    validation: {},
    admin: {
      component: componentPath,
      condition: { field: "editormode", equals: "builder" },
    },
  } as unknown as T;
  return [...fields, editormode, content];
}

export function removePageBuilderFields<T extends BuilderFieldLike>(
  fields: T[]
): T[] {
  return fields.filter(f => f.name !== "editormode" && !isCanvasField(f));
}

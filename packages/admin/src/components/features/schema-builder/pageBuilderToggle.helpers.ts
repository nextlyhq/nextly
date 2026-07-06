/**
 * Pure add/remove of the Page Builder editor-choice fields for the schema builder's field
 * list. Enabling appends an `editormode` select + a reserved `content` canvas field of the
 * plugin's `page-builder` field type (rendered by the plugin editor via the plugin's
 * registered field-type → component mapping). Disabling removes both. Idempotent.
 */

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
  fields: T[]
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
    type: "page-builder",
    validation: {},
    admin: { condition: { field: "editormode", equals: "builder" } },
  } as unknown as T;
  return [...fields, editormode, content];
}

export function removePageBuilderFields<T extends BuilderFieldLike>(
  fields: T[]
): T[] {
  return fields.filter(f => f.name !== "editormode" && !isCanvasField(f));
}

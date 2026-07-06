/**
 * Pure add/remove of the Page Builder editor-choice fields for the schema builder's field
 * list. Enabling appends an `editormode` select + a reserved `content` field of the plugin's
 * `page-builder` type (shown only in builder mode); disabling removes both. Idempotent.
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

export function hasPageBuilderFields(fields: BuilderFieldLike[]): boolean {
  return (
    fields.some(f => f.name === "editormode") &&
    fields.some(f => f.type === "page-builder")
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
  return fields.filter(
    f => f.name !== "editormode" && f.type !== "page-builder"
  );
}

/**
 * Admin-side detection + field-narrowing for the Page Builder editor choice.
 *
 * An entity offers the choice when the code-first `admin.pageBuilder.enabled` flag is set OR
 * its schema carries an `editormode` select + the page-builder canvas field (a `json` field
 * whose `admin.component` is the plugin's editor, added code-first via `withPageBuilder()` or
 * via the schema-builder toggle). When an entry is in Page Builder mode, the edit form shows
 * only the canvas + the editor switch; title/slug/status are separate system components.
 */
// All-lowercase: the schema builder normalizes field names to lowercase, and code-first uses
// the same lowercase name, so detection stays stable across both.
export const EDITOR_MODE_FIELD = "editormode";

interface Field {
  name?: string;
  type?: string;
  admin?: unknown;
}
interface EntityAdmin {
  pageBuilder?: { enabled?: boolean };
}

/** True for the page-builder canvas field — a `json` field wired to the plugin editor, or the
 *  legacy `page-builder` field type. Matched by the plugin's component path, not a field name. */
export function isCanvasField(f: Field): boolean {
  if (f.type === "page-builder") return true;
  const component = (f.admin as { component?: string } | null | undefined)
    ?.component;
  return (
    typeof component === "string" && component.includes("plugin-page-builder")
  );
}

export function isPageBuilderEnabled(
  fields: Field[],
  admin: EntityAdmin | undefined
): boolean {
  if (admin?.pageBuilder?.enabled === true) return true;
  const hasMode = fields.some(f => f.name === EDITOR_MODE_FIELD);
  return hasMode && fields.some(isCanvasField);
}

export function computeMainFields<T extends Field>(
  fields: T[],
  opts: { enabled: boolean; editorMode: unknown }
): T[] {
  const body = fields.filter(f => f.name !== "title" && f.name !== "slug");
  if (opts.enabled && opts.editorMode === "builder") {
    return body.filter(f => f.name === EDITOR_MODE_FIELD || isCanvasField(f));
  }
  return body;
}

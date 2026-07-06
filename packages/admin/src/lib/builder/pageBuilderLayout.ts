/**
 * Admin-side detection + field-narrowing for the Page Builder editor choice.
 *
 * An entity offers the choice when the code-first `admin.pageBuilder.enabled` flag is set OR
 * its schema carries an `editorMode` select + a `page-builder` field (added code-first via
 * `withPageBuilder()` or via the schema-builder toggle). When an entry is in Page Builder
 * mode, the edit form shows only the canvas + the editor switch; title/slug/status are
 * rendered by separate system components and are never in this list.
 */
export const EDITOR_MODE_FIELD = "editorMode";
export const PAGE_BUILDER_FIELD_TYPE = "page-builder";

interface Field {
  name?: string;
  type?: string;
}
interface EntityAdmin {
  pageBuilder?: { enabled?: boolean };
}

export function isPageBuilderEnabled(
  fields: Field[],
  admin: EntityAdmin | undefined
): boolean {
  if (admin?.pageBuilder?.enabled === true) return true;
  const hasMode = fields.some(f => f.name === EDITOR_MODE_FIELD);
  const hasCanvas = fields.some(f => f.type === PAGE_BUILDER_FIELD_TYPE);
  return hasMode && hasCanvas;
}

export function computeMainFields<T extends Field>(
  fields: T[],
  opts: { enabled: boolean; editorMode: unknown }
): T[] {
  const body = fields.filter(f => f.name !== "title" && f.name !== "slug");
  if (opts.enabled && opts.editorMode === "builder") {
    return body.filter(
      f => f.name === EDITOR_MODE_FIELD || f.type === PAGE_BUILDER_FIELD_TYPE
    );
  }
  return body;
}

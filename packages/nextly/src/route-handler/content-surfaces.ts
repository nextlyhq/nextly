/**
 * Content-surface introspection (the plugin-facing seam).
 *
 * `listContentSurfaces()` answers "what collections and singles does THIS app
 * have right now, and what fields do they carry?" — covering every origin:
 * code-first (nextly.config), plugin-contributed, and dynamic ones created
 * through the admin Schema Builder (persisted in the database). The registry
 * services query the DB on every call, so a collection created a moment ago is
 * already in the answer — the docs plugin uses this so dynamically created
 * content appears in the spec without a restart.
 *
 * Fields are returned opaque (`unknown[]`): the consumer (the api-docs plugin)
 * projects the wire-shaping options it cares about; core's full `FieldConfig`
 * union stays out of the stable surface.
 *
 * @module route-handler/content-surfaces
 * @since alpha
 */
import { container } from "../di/container";

/** One content surface (collection or single), as introspection consumers see it. */
export interface ContentSurfaceInfo {
  slug: string;
  /** Display labels; singles carry a singular label only. */
  labels?: { singular?: string; plural?: string };
  /** The field configs (`FieldConfig[]` in core terms), opaque here. */
  fields: unknown[];
  /** Origin: `"code"`, `"ui"`, or `"plugin:<name>"` — informational. */
  source?: string;
}

/** All content surfaces the app currently has. */
export interface ContentSurfaces {
  collections: ContentSurfaceInfo[];
  singles: ContentSurfaceInfo[];
}

/** The minimal registry record shape this seam reads (structural). */
interface RegistryRecord {
  slug?: unknown;
  labels?: unknown;
  label?: unknown;
  fields?: unknown;
  source?: unknown;
}

function labelsOf(record: RegistryRecord): ContentSurfaceInfo["labels"] {
  const labels = record.labels as
    { singular?: string; plural?: string } | undefined;
  if (labels && typeof labels === "object") return labels;
  // Singles persist a singular `label` string rather than a labels object.
  const label = record.label;
  return typeof label === "string" ? { singular: label } : undefined;
}

function project(records: RegistryRecord[]): ContentSurfaceInfo[] {
  return records
    .filter((r): r is RegistryRecord => typeof r === "object" && r !== null)
    .map(r => ({
      slug: typeof r.slug === "string" ? r.slug : "",
      labels: labelsOf(r),
      fields: Array.isArray(r.fields) ? r.fields : [],
      source: typeof r.source === "string" ? r.source : undefined,
    }))
    .filter(r => r.slug.length > 0);
}

/**
 * List every registered collection and single with its fields. Reads the
 * runtime registry services through the DI container; when DI has not run
 * (e.g. a tool importing the package outside a booted app) both arrays are
 * empty rather than an error — callers fall back to their own config view.
 */
export async function listContentSurfaces(): Promise<ContentSurfaces> {
  const result: ContentSurfaces = { collections: [], singles: [] };

  if (container.has("collectionRegistryService")) {
    const svc = container.get<{ getAllCollections?: () => Promise<unknown> }>(
      "collectionRegistryService"
    );
    if (typeof svc?.getAllCollections === "function") {
      const records = (await svc.getAllCollections()) as RegistryRecord[];
      if (Array.isArray(records)) result.collections = project(records);
    }
  }

  if (container.has("singleRegistryService")) {
    const svc = container.get<{ getAllSingles?: () => Promise<unknown> }>(
      "singleRegistryService"
    );
    if (typeof svc?.getAllSingles === "function") {
      const records = (await svc.getAllSingles()) as RegistryRecord[];
      if (Array.isArray(records)) result.singles = project(records);
    }
  }

  return result;
}

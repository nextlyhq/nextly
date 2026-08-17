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
 * Read one registry's surfaces, honoring the seam's "empty rather than error"
 * contract. A missing container binding, a missing method, OR a registry that
 * REJECTS (the services query the database on every call, so an unreachable
 * database rejects) all degrade to an empty projection — the caller falls back
 * to its own config view instead of the whole request failing.
 */
async function readSurfaces<T>(
  key: string,
  read: (svc: T) => unknown
): Promise<ContentSurfaceInfo[]> {
  if (!container.has(key)) return [];
  try {
    const svc = container.get<T>(key);
    const records = (await read(svc)) as RegistryRecord[];
    return Array.isArray(records) ? project(records) : [];
  } catch {
    return [];
  }
}

/**
 * List every registered collection and single with its fields. Reads the
 * runtime registry services through the DI container; when DI has not run,
 * a service is missing, or a registry cannot answer, both arrays are empty
 * rather than an error — callers fall back to their own config view.
 */
export async function listContentSurfaces(): Promise<ContentSurfaces> {
  return {
    collections: await readSurfaces<{
      getAllCollections?: () => Promise<unknown>;
    }>("collectionRegistryService", svc =>
      typeof svc?.getAllCollections === "function"
        ? svc.getAllCollections()
        : []
    ),
    singles: await readSurfaces<{ getAllSingles?: () => Promise<unknown> }>(
      "singleRegistryService",
      svc =>
        typeof svc?.getAllSingles === "function" ? svc.getAllSingles() : []
    ),
  };
}

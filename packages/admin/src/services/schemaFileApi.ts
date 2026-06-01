/**
 * Dev-only client for writing `ui-schema.json` via the package's
 * `/admin/api/_dev/schema/*` endpoints (spec §4.12.3). Used by the schema
 * builder when `isUiSchemaWriteMode()` is active.
 *
 * @module services/schemaFileApi
 * @since v0.0.3-alpha (Plan D4)
 */
import { protectedApi } from "../lib/api/protectedApi";
import type { ManifestEntity } from "../lib/builder/to-manifest-entity";

interface DevSchemaWriteResponse {
  message: string;
  kind: string;
}

export const schemaFileApi = {
  /**
   * Upsert a collection in ui-schema.json. The `/admin/api` prefix is added by
   * the fetcher's BASE_URL.
   */
  writeCollection: (entity: ManifestEntity) =>
    protectedApi.post<DevSchemaWriteResponse>(
      "/_dev/schema/collection",
      entity
    ),
};

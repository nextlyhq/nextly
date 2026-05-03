/**
 * Component API Service
 *
 * API client for Component definition management operations.
 * Follows the established pattern from collectionApi.ts.
 *
 * @see collectionApi.ts - Reference pattern
 */

import type { ListResponse, TableParams } from "@revnixhq/ui";

import type { ApiComponent } from "@admin/types/entities";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { protectedApi } from "../lib/api/protectedApi";
import type {
  ActionResponse,
  MutationResponse,
} from "../lib/api/response-types";

import type {
  FieldResolution,
  SchemaApplyResponse,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "./schemaApi";

/**
 * Payload for creating a new Component via API
 */
export interface CreateComponentPayload {
  slug: string;
  label: string;
  description?: string;
  fields: Record<string, unknown>[];
  admin?: {
    category?: string;
    icon?: string;
    hidden?: boolean;
    description?: string;
    imageURL?: string;
  };
}

/**
 * Payload for updating an existing Component via API
 */
export interface UpdateComponentPayload {
  label?: string;
  description?: string;
  fields?: Record<string, unknown>[];
  admin?: {
    category?: string;
    icon?: string;
    hidden?: boolean;
    description?: string;
    imageURL?: string;
  };
}

// Build query string for pagination and search using shared utility
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      slug: "slug",
      label: "label",
      source: "source",
      createdAt: "createdAt",
    },
    validSortFields: ["slug", "label", "createdAt"],
  });
};

/**
 * Fetch paginated list of Component definitions.
 *
 * Phase 4.7: pass canonical ListResponse straight through. The legacy
 * normalizePagination adapter is gone.
 */
export const fetchComponents = async (
  params: TableParams
): Promise<ListResponse<ApiComponent>> => {
  const query = buildQuery(params);
  const url = `/components${query ? `?${query}` : ""}`;
  return fetcher<ListResponse<ApiComponent>>(url, {}, true);
};

/**
 * Delete a Component definition by slug.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiComponent>` or
 * `ActionResponse` (delete may be either depending on whether the dispatcher
 * surfaces the deleted record); we discard the body.
 */
export const deleteComponent = async (componentSlug: string): Promise<void> => {
  await fetcher<MutationResponse<unknown>>(
    `/components/${componentSlug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Component API service object.
 *
 * Phase 4.6c: server emits canonical `respondX` shapes (spec §5.1). list ->
 * `ListResponse<T>`; bare reads -> `T`; create/update -> `MutationResponse<T>`
 * (`{ message, item }`). We surface the bare `ApiComponent` to callers so
 * mutations match the read shape; toast text comes from `message` when
 * needed.
 */
export const componentApi = {
  fetchComponents,
  deleteComponent,

  /**
   * List all Component definitions (simple list, no pagination).
   */
  list: async (): Promise<ApiComponent[]> => {
    const result =
      await protectedApi.get<ListResponse<ApiComponent>>("/components");
    return result.items;
  },

  /**
   * Get a single Component definition by slug.
   */
  get: async (componentSlug: string): Promise<ApiComponent> => {
    return protectedApi.get<ApiComponent>(`/components/${componentSlug}`);
  },

  /**
   * Create a new Component definition.
   */
  create: async (payload: CreateComponentPayload): Promise<ApiComponent> => {
    const result = await protectedApi.post<MutationResponse<ApiComponent>>(
      "/components",
      payload
    );
    return result.item;
  },

  /**
   * Update an existing Component definition.
   */
  update: async (
    componentSlug: string,
    payload: UpdateComponentPayload
  ): Promise<ApiComponent> => {
    const result = await protectedApi.patch<MutationResponse<ApiComponent>>(
      `/components/${componentSlug}`,
      payload
    );
    return result.item;
  },

  /**
   * Remove a Component definition.
   */
  remove: async (componentSlug: string): Promise<{ message: string }> => {
    const result = await protectedApi.delete<MutationResponse<ApiComponent>>(
      `/components/${componentSlug}`
    );
    return { message: result.message };
  },

  /**
   * Preview component schema changes — dry-run diff with rename candidates.
   * Mirrors schemaApi.preview() for collections.
   */
  previewSchemaChanges: async (
    componentSlug: string,
    fields: unknown[]
  ): Promise<SchemaPreviewResponse> => {
    return protectedApi.post<SchemaPreviewResponse>(
      `/components/schema/${componentSlug}/preview`,
      { fields }
    );
  },

  /**
   * Apply confirmed component schema changes via PushSchemaPipeline.
   * Mirrors schemaApi.apply() for collections.
   */
  applySchemaChanges: async (
    componentSlug: string,
    fields: unknown[],
    schemaVersion: number,
    resolutions?: Record<string, FieldResolution>,
    renameResolutions?: SchemaRenameResolution[]
  ): Promise<SchemaApplyResponse> => {
    const result = await protectedApi.post<
      ActionResponse<{ newSchemaVersion: number; toastSummary?: string }>
    >(`/components/schema/${componentSlug}/apply`, {
      fields,
      confirmed: true,
      schemaVersion,
      resolutions,
      renameResolutions,
    });
    return {
      success: true,
      message: result.message,
      newSchemaVersion: result.newSchemaVersion,
      toastSummary: result.toastSummary,
    };
  },
} as const;

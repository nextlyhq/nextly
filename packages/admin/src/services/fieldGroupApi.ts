/**
 * Component API Service
 *
 * API client for Component definition management operations.
 * Follows the established pattern from collectionApi.ts.
 *
 * @see collectionApi.ts - Reference pattern
 */

import type { ListResponse, TableParams } from "@nextlyhq/ui";

import type { ApiFieldGroup } from "@admin/types/entities";

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
  /** i18n: whether the component is localized (translatable fields live in comp_<slug>_locales). */
  localized?: boolean;
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
  /** i18n: the Internationalization toggle. Provisions/persists the companion when true. */
  localized?: boolean;
}

/**
 * The list filters this endpoint applies SERVER-SIDE.
 *
 * Named rather than forwarded wholesale: `buildQuery` would emit the whole `filters` record as one
 * JSON parameter, and this dispatcher reads flat query params. Listing them also keeps an unknown
 * key from being sent and silently ignored, which reads to a caller exactly like a filter that
 * worked.
 */
const SERVER_FILTERS = ["source", "migrationStatus"] as const;

// Build query string for pagination and search using shared utility
const buildQuery = (params: TableParams): string => {
  const base = buildQueryUtil(params, {
    fieldMapping: {
      slug: "slug",
      label: "label",
      source: "source",
      createdAt: "createdAt",
    },
    validSortFields: ["slug", "label", "createdAt"],
  });

  // Appended as flat params, matching what the dispatcher reads. Empty and "all" are omitted rather
  // than sent: the absence of the parameter IS "do not filter", so sending a sentinel would make
  // the server reject a selection that means no filter at all.
  const query = new URLSearchParams(base);
  const filters = params.filters?.filters ?? {};
  for (const name of SERVER_FILTERS) {
    const value = filters[name];
    if (typeof value === "string" && value !== "" && value !== "all") {
      query.set(name, value);
    }
  }
  return query.toString();
};

/**
 * Fetch paginated list of Component definitions.
 */
export const fetchComponents = async (
  params: TableParams
): Promise<ListResponse<ApiFieldGroup>> => {
  const query = buildQuery(params);
  const url = `/field-groups${query ? `?${query}` : ""}`;
  return fetcher<ListResponse<ApiFieldGroup>>(url, {}, true);
};

/**
 * Delete a Component definition by slug. Caller expects void;
 * we discard the response body (which may be MutationResponse or
 * ActionResponse depending on the dispatcher path).
 */
export const deleteFieldGroup = async (
  fieldGroupSlug: string
): Promise<void> => {
  await fetcher<MutationResponse<unknown>>(
    `/field-groups/${fieldGroupSlug}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Component API service object.
 *
 * Server emits canonical `respondX` shapes (spec §5.1): list ->
 * `ListResponse<T>`; bare reads -> `T`; create/update ->
 * `MutationResponse<T>`. We surface the bare `ApiFieldGroup` to
 * callers so mutations match the read shape; toast text comes from
 * `message` when needed.
 */
export const fieldGroupApi = {
  fetchComponents,
  deleteFieldGroup,

  /**
   * List all Component definitions (simple list, no pagination).
   */
  list: async (): Promise<ApiFieldGroup[]> => {
    const result =
      await protectedApi.get<ListResponse<ApiFieldGroup>>("/field-groups");
    return result.items;
  },

  /**
   * Get a single Component definition by slug.
   */
  get: async (fieldGroupSlug: string): Promise<ApiFieldGroup> => {
    return protectedApi.get<ApiFieldGroup>(`/field-groups/${fieldGroupSlug}`);
  },

  /**
   * Create a new Component definition.
   */
  create: async (payload: CreateComponentPayload): Promise<ApiFieldGroup> => {
    const result = await protectedApi.post<MutationResponse<ApiFieldGroup>>(
      "/field-groups",
      payload
    );
    return result.item;
  },

  /**
   * Update an existing Component definition.
   */
  update: async (
    fieldGroupSlug: string,
    payload: UpdateComponentPayload
  ): Promise<ApiFieldGroup> => {
    const result = await protectedApi.patch<MutationResponse<ApiFieldGroup>>(
      `/field-groups/${fieldGroupSlug}`,
      payload
    );
    return result.item;
  },

  /**
   * Remove a Component definition.
   */
  remove: async (fieldGroupSlug: string): Promise<{ message: string }> => {
    const result = await protectedApi.delete<MutationResponse<ApiFieldGroup>>(
      `/field-groups/${fieldGroupSlug}`
    );
    return { message: result.message };
  },

  /**
   * Preview component schema changes — dry-run diff with rename candidates.
   * Mirrors schemaApi.preview() for collections.
   */
  previewSchemaChanges: async (
    fieldGroupSlug: string,
    fields: unknown[]
  ): Promise<SchemaPreviewResponse> => {
    return protectedApi.post<SchemaPreviewResponse>(
      `/field-groups/schema/${fieldGroupSlug}/preview`,
      { fields }
    );
  },

  /**
   * Apply confirmed component schema changes via PushSchemaPipeline.
   * Mirrors schemaApi.apply() for collections.
   */
  applySchemaChanges: async (
    fieldGroupSlug: string,
    fields: unknown[],
    schemaVersion: number,
    resolutions?: Record<string, FieldResolution>,
    renameResolutions?: SchemaRenameResolution[],
    // i18n: the current Internationalization toggle, so an apply that flips i18n AND changes
    // fields provisions the companion in the same request. Undefined leaves the persisted value.
    localized?: boolean
  ): Promise<SchemaApplyResponse> => {
    const result = await protectedApi.post<
      ActionResponse<{ newSchemaVersion: number; toastSummary?: string }>
    >(`/field-groups/schema/${fieldGroupSlug}/apply`, {
      fields,
      confirmed: true,
      schemaVersion,
      resolutions,
      renameResolutions,
      ...(localized !== undefined ? { localized } : {}),
    });
    return {
      success: true,
      message: result.message,
      newSchemaVersion: result.newSchemaVersion,
      toastSummary: result.toastSummary,
    };
  },
} as const;

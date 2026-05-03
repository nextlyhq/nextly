import type { ListResponse, TableParams } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { fetcher } from "../lib/api/fetcher";
import { protectedApi } from "../lib/api/protectedApi";
import type { MutationResponse } from "../lib/api/response-types";
import type {
  Collection,
  CreateCollectionPayload,
  UpdateCollectionPayload,
  Entry,
} from "../types/collection";
import type { ApiCollection } from "../types/entities";

// Build query string for pagination and search using shared utility
const buildQuery = (params: TableParams): string => {
  return buildQueryUtil(params, {
    fieldMapping: {
      name: "name",
      email: "email",
      roles: "roles",
      created: "createdAt",
    },
    validSortFields: ["name", "email", "createdAt", "roles"],
  });
};

/**
 * Fetch collections with pagination.
 *
 * Phase 4.7: pass canonical ListResponse straight through. The legacy
 * normalizePagination adapter is gone.
 */
export const fetchCollections = async (
  params: TableParams
): Promise<ListResponse<ApiCollection>> => {
  const query = buildQuery(params);
  const url = `/collections${query ? `?${query}` : ""}`;

  const result = await fetcher<ListResponse<ApiCollection>>(url, {}, true);

  if (process.env.NODE_ENV === "development") {
    const withSG = result.items.filter(
      (c: ApiCollection) => c.admin?.sidebarGroup
    );
    if (withSG.length > 0) {
      console.log(
        "[fetchCollections] Collections with sidebarGroup in API response:",
        withSG.map((c: ApiCollection) => ({
          name: c.name,
          sidebarGroup: c.admin?.sidebarGroup,
          admin: c.admin,
        }))
      );
    } else {
      console.log(
        "[fetchCollections] No collections have admin.sidebarGroup. Sample admin fields:",
        result.items
          .slice(0, 3)
          .map((c: ApiCollection) => ({ name: c.name, admin: c.admin }))
      );
    }
  }

  return result;
};

/**
 * Delete a collection.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiCollection>`;
 * we discard the body.
 */
export const deleteCollection = async (collectionId: string): Promise<void> => {
  await fetcher<MutationResponse<ApiCollection>>(
    `/collections/${collectionId}`,
    {
      method: "DELETE",
    },
    true
  );
};

/**
 * Collection API client surface.
 *
 * Phase 4 (Task 19): the `protectedApi.*` calls below now receive the raw
 * canonical body straight from `fetcher`. List endpoints return
 * `ListResponse<T>`; bare reads (get, getSchema, listEntries) return the
 * doc directly; create/update/remove/createEntry/deleteEntry return
 * `MutationResponse<T>`. The legacy `{ message }` projection is preserved
 * by mapping `response.message` from the canonical mutation envelope.
 */
export const collectionApi = {
  fetchCollections,
  deleteCollection,
  list: async (): Promise<Collection[]> => {
    const result =
      await protectedApi.get<ListResponse<Collection>>("/collections");
    return result.items;
  },

  get: async (collectionName: string): Promise<Collection> => {
    return protectedApi.get<Collection>(`/collections/${collectionName}`);
  },

  getSchema: async (collectionName: string): Promise<Collection> => {
    return protectedApi.get<Collection>(
      `/collections/schema/${collectionName}`
    );
  },

  create: async (
    payload: CreateCollectionPayload
  ): Promise<{ message: string }> => {
    const result = await protectedApi.post<MutationResponse<ApiCollection>>(
      "/collections",
      payload
    );
    return { message: result.message };
  },

  update: async (
    collectionName: string,
    payload: UpdateCollectionPayload
  ): Promise<{ message: string }> => {
    const result = await protectedApi.patch<MutationResponse<ApiCollection>>(
      `/collections/${collectionName}`,
      payload
    );
    return { message: result.message };
  },

  remove: async (collectionName: string): Promise<{ message: string }> => {
    const result = await protectedApi.delete<MutationResponse<ApiCollection>>(
      `/collections/${collectionName}`
    );
    return { message: result.message };
  },

  listEntries: async (collectionName: string): Promise<Entry[]> => {
    // Sub-resource list endpoints return ListResponse<Entry> (`{ items, meta }`);
    // the legacy callers expect a bare array, so we project items.
    const result = await protectedApi.get<ListResponse<Entry>>(
      `/collections/${collectionName}/entries`
    );
    return result.items;
  },

  createEntry: async (
    collectionName: string,
    data: Record<string, unknown>
  ): Promise<{ message: string }> => {
    const result = await protectedApi.post<MutationResponse<Entry>>(
      `/collections/${collectionName}/entries`,
      data
    );
    return { message: result.message };
  },

  deleteEntry: async (
    collectionName: string,
    entryId: string
  ): Promise<{ message: string }> => {
    const result = await protectedApi.delete<MutationResponse<Entry>>(
      `/collections/${collectionName}/entries/${entryId}`
    );
    return { message: result.message };
  },
} as const;

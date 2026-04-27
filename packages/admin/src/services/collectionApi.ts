import type { TableParams, TableResponse } from "@revnixhq/ui";

import { buildQuery as buildQueryUtil } from "../lib/api/buildQuery";
import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";
import { protectedApi } from "../lib/api/protectedApi";
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

export const fetchCollections = async (
  params: TableParams
): Promise<TableResponse<ApiCollection>> => {
  const query = buildQuery(params);
  const url = `/collections${query ? `?${query}` : ""}`;

  const result = await enhancedFetcher<
    ApiCollection[],
    Record<string, unknown>
  >(url, {}, true);

  const collections = result.data;
  if (process.env.NODE_ENV === "development") {
    const withSG = collections.filter(
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
        collections
          .slice(0, 3)
          .map((c: ApiCollection) => ({ name: c.name, admin: c.admin }))
      );
    }
  }
  const { pageSize = 10 } = params.pagination;
  const meta = normalizePagination(result.meta, pageSize, collections.length);

  return { data: collections, meta };
};

export const deleteCollection = async (collectionId: string): Promise<void> => {
  await enhancedFetcher<null>(
    `/collections/${collectionId}`,
    {
      method: "DELETE",
    },
    true
  );
};

export const collectionApi = {
  fetchCollections,
  deleteCollection,
  list: async (): Promise<Collection[]> => {
    return protectedApi.get<Collection[]>("/collections");
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
    return protectedApi.post<{ message: string }>("/collections", payload);
  },

  update: async (
    collectionName: string,
    payload: UpdateCollectionPayload
  ): Promise<{ message: string }> => {
    return protectedApi.patch<{ message: string }>(
      `/collections/${collectionName}`,
      payload
    );
  },

  remove: async (collectionName: string): Promise<{ message: string }> => {
    return protectedApi.delete<{ message: string }>(
      `/collections/${collectionName}`
    );
  },

  listEntries: async (collectionName: string): Promise<Entry[]> => {
    return protectedApi.get<Entry[]>(`/collections/${collectionName}/entries`);
  },

  createEntry: async (
    collectionName: string,
    data: Record<string, unknown>
  ): Promise<{ message: string }> => {
    return protectedApi.post<{ message: string }>(
      `/collections/${collectionName}/entries`,
      data
    );
  },

  deleteEntry: async (
    collectionName: string,
    entryId: string
  ): Promise<{ message: string }> => {
    return protectedApi.delete<{ message: string }>(
      `/collections/${collectionName}/entries/${entryId}`
    );
  },
} as const;

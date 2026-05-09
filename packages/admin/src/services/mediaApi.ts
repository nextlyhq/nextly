/**
 * Media API Service
 *
 * Service functions for media library operations (upload, fetch, update, delete).
 * Connects to the backend MediaService via Next.js API routes.
 *
 * ## API Integration
 *
 * This client makes HTTP requests to `/api/media` endpoints which are implemented
 * in the consumer's Next.js application by re-exporting handlers from `nextly/api/media`.
 *
 * ## Architecture
 *
 * ```
 * Frontend (mediaApi.ts)
 *   ↓ HTTP fetch/XMLHttpRequest
 * API Routes (/api/media)
 *   ↓ Function calls
 * MediaService (nextly)
 *   ↓ Database queries
 * PostgreSQL/MySQL/SQLite
 * ```
 *
 * @see nextly/api/media - Backend API handlers
 */

import { getCurrentUserId } from "@admin/lib/auth/session";

import { parseApiError } from "../lib/api/parseApiError";
import {
  authFetch,
  readAuthErrorCodeFromText,
  redirectToLogin,
  refreshAccessToken,
} from "../lib/api/refreshInterceptor";
import type { BulkResponse } from "../lib/api/response-types";
import type {
  Media,
  MediaListResponse,
  MediaParams,
  MediaUpdateInput,
  MediaFolder,
  CreateFolderInput,
  UpdateFolderInput,
  FolderResponse,
  FolderContentsResponse,
} from "../types/media";

// ============================================================
// Internal fetch helper
// ============================================================

/**
 * Shared fetch wrapper for media API endpoints.
 *
 * The backend now returns canonical respondX bodies (spec §5.1).
 * This helper handles the network/error concerns; each call site decodes
 * the body into the right shape (bare doc, `{ items, meta }`, `{ message,
 * item }`, or `{ message, ...result }`) using the typed helpers below.
 */
async function mediaFetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await authFetch(url, options);

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw parseApiError(json, response.status);
  }

  return (await response.json()) as T;
}

async function mediaFetchVoid(
  url: string,
  options?: RequestInit
): Promise<void> {
  const response = await authFetch(url, options);

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw parseApiError(json, response.status);
  }
}

// ============================================================
// Upload (XMLHttpRequest for progress tracking)
// ============================================================

/**
 * Upload a single media file with progress tracking
 *
 * Uses XMLHttpRequest instead of fetch to support upload progress events.
 * FormData is automatically handled by the browser with proper Content-Type header.
 *
 * @param file - File to upload
 * @param onProgress - Progress callback (0-100)
 * @returns Promise resolving to uploaded Media object
 *
 * @throws Error if upload fails or file is invalid
 */
interface XhrUploadResult {
  status: number;
  responseText: string;
}

function uploadMediaOnce(
  formData: FormData,
  onProgress?: (progress: number) => void
): Promise<XhrUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", event => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress?.(progress);
      }
    });

    xhr.addEventListener("load", () => {
      resolve({ status: xhr.status, responseText: xhr.responseText });
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    xhr.open("POST", "/api/media");
    xhr.send(formData);
  });
}

export async function uploadMedia(
  file: File,
  onProgress?: (progress: number) => void,
  folderId?: string | null
): Promise<Media> {
  const userId = await getCurrentUserId();

  const formData = new FormData();
  formData.append("file", file);
  formData.append("uploadedBy", userId);
  if (folderId) {
    formData.append("folderId", folderId);
  }

  // XMLHttpRequest-based uploads can't route through `authFetch`, so we
  // reproduce its single-retry 401→refresh contract here. Progress events
  // from the first attempt still fire normally.
  let result = await uploadMediaOnce(formData, onProgress);

  if (result.status === 401) {
    const code = readAuthErrorCodeFromText(result.responseText);
    if (code === "TOKEN_EXPIRED") {
      if (await refreshAccessToken()) {
        result = await uploadMediaOnce(formData, onProgress);
      } else {
        redirectToLogin();
      }
    } else if (code === "AUTH_REQUIRED" || code === "SESSION_UPGRADED") {
      redirectToLogin();
    }
  }

  if (result.status >= 200 && result.status < 300) {
    // Canonical respondMutation wire shape (spec §5.1):
    // { message, item: Media }.
    try {
      const response = JSON.parse(result.responseText) as {
        item?: Media;
      };
      if (response.item) {
        return response.item;
      }
      throw new Error("Upload succeeded but server returned no item.");
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error("Failed to parse server response");
    }
  }

  // Non-2xx: parse the canonical error response and surface it via parseApiError.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(result.responseText);
  } catch {
    // ignore parse failure — fall through to the generic message
  }
  throw parseApiError(parsed, result.status);
}

// ============================================================
// Media CRUD
// ============================================================

/**
 * Fetch paginated list of media items
 */
export async function fetchMedia(
  params: MediaParams = {}
): Promise<MediaListResponse> {
  const queryParams = new URLSearchParams();

  if (params.page) queryParams.set("page", String(params.page));
  if (params.limit) queryParams.set("limit", String(params.limit));
  if (params.search) queryParams.set("search", params.search);
  if (params.type) queryParams.set("type", params.type);
  if (params.sortBy) queryParams.set("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);
  if (params.folderId) {
    queryParams.set("folderId", params.folderId);
  }

  // Canonical respondList wire shape (spec §5.1):
  // { items, meta: { total, page, limit, totalPages, hasNext, hasPrev } }.
  const result = await mediaFetchJson<{
    items?: Media[];
    meta?: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }>(`/api/media?${queryParams.toString()}`);

  return {
    data: result.items || [],
    meta: (result.meta as MediaListResponse["meta"]) || {
      total: 0,
      page: params.page || 1,
      limit: params.limit || 24,
      totalPages: 0,
    },
    success: true,
    statusCode: 200,
    message: "",
  };
}

/**
 * Fetch a single media item by ID
 */
export async function getMediaById(mediaId: string): Promise<Media> {
  // respondDoc returns the bare row.
  return mediaFetchJson<Media>(`/api/media/${mediaId}`);
}

/**
 * Update media metadata
 */
export async function updateMedia(
  mediaId: string,
  updates: MediaUpdateInput
): Promise<void> {
  // respondMutation { message, item }; caller does not need the item back.
  await mediaFetchVoid(`/api/media/${mediaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

/**
 * Delete a media item
 */
export async function deleteMedia(mediaId: string): Promise<void> {
  // respondAction { message, id }; caller does not need the id back.
  await mediaFetchVoid(`/api/media/${mediaId}`, { method: "DELETE" });
}

/**
 * Bulk delete multiple media files.
 *
 * Hits `DELETE /api/media/bulk` (server `media-bulk.ts` DELETE handler).
 * Single round-trip; server runs per-id deletes concurrently with full
 * access-control + storage-cleanup pipeline; partial failures returned
 * in `errors[]` with structured `{ id, code, message }`.
 *
 * `items` contains `[{id}, ...]` for the successfully deleted ids
 * (no full record, since the entries are gone).
 *
 * @example
 * ```typescript
 * const result = await bulkDeleteMedia(['m1', 'm2', 'm3']);
 * toast(result.message);
 * if (result.errors.length > 0) {
 *   // each error has { id, code, message } with canonical NextlyErrorCode
 * }
 * ```
 */
export async function bulkDeleteMedia(
  mediaIds: string[]
): Promise<BulkResponse<{ id: string }>> {
  const response = await authFetch("/api/media/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaIds }),
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw parseApiError(json, response.status);
  }

  return (await response.json()) as BulkResponse<{ id: string }>;
}

// ============================================================
// Folder CRUD
// ============================================================

/**
 * Create a new folder
 */
export async function createFolder(
  input: CreateFolderInput
): Promise<MediaFolder> {
  const userId = await getCurrentUserId();

  // respondMutation: { message, item: Folder }.
  const result = await mediaFetchJson<{ item?: MediaFolder }>(
    "/api/media/folders",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, createdBy: userId }),
    }
  );
  if (!result.item) {
    throw new Error("Failed to create folder");
  }
  return result.item;
}

/**
 * Get folder by ID with breadcrumbs
 */
export async function getFolderById(
  folderId: string
): Promise<FolderResponse["data"]> {
  // respondDoc returns the bare folder row (with breadcrumbs).
  return mediaFetchJson<FolderResponse["data"]>(
    `/api/media/folders/${folderId}`
  );
}

/**
 * List root folders (folders with no parent)
 */
export async function listRootFolders(): Promise<MediaFolder[]> {
  // respondData { folders: MediaFolder[] } (non-paginated list, named field).
  const result = await mediaFetchJson<{ folders?: MediaFolder[] }>(
    "/api/media/folders?root=true"
  );
  return result.folders || [];
}

/**
 * List subfolders within a parent folder
 */
export async function listSubfolders(parentId: string): Promise<MediaFolder[]> {
  const result = await mediaFetchJson<{ folders?: MediaFolder[] }>(
    `/api/media/folders?parentId=${parentId}`
  );
  return result.folders || [];
}

/**
 * Get folder contents (subfolders + media files)
 */
export async function getFolderContents(
  folderId: string | null
): Promise<FolderContentsResponse["data"]> {
  const url = folderId
    ? `/api/media/folders/${folderId}/contents`
    : "/api/media/folders/root/contents";

  // respondData ships the structured contents object bare.
  return mediaFetchJson<FolderContentsResponse["data"]>(url);
}

/**
 * Update folder metadata
 */
export async function updateFolder(
  folderId: string,
  updates: UpdateFolderInput
): Promise<MediaFolder> {
  const result = await mediaFetchJson<{ item?: MediaFolder }>(
    `/api/media/folders/${folderId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!result.item) {
    throw new Error("Failed to update folder");
  }
  return result.item;
}

/**
 * Delete folder
 */
export async function deleteFolder(
  folderId: string,
  deleteContents: boolean = false
): Promise<void> {
  await mediaFetchVoid(
    `/api/media/folders/${folderId}?deleteContents=${deleteContents}`,
    { method: "DELETE" }
  );
}

/**
 * Move media to a different folder
 */
export async function moveMediaToFolder(
  mediaId: string,
  folderId: string | null
): Promise<Media | null> {
  // respondAction returns { message, id, folderId }; the caller's pre-Phase-4
  // signature returned the moved record; the new endpoint omits it because
  // the admin already has the row in cache. Keep the public signature for
  // backwards compatibility with callers but always resolve to null.
  await mediaFetchVoid(`/api/media/${mediaId}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  return null;
}

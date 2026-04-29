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

interface MediaApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  message?: string;
  statusCode?: number;
}

/**
 * Shared fetch wrapper for media API endpoints.
 *
 * The backend now returns canonical `{ data, meta? }` responses (per spec
 * §10.2). This helper synthesizes the legacy `MediaApiResponse<T>` shape
 * (`{ success, data, meta, message, statusCode }`) so the existing callers
 * keep working without touching every call site — `success: true` is implied
 * by a 2xx response and the legacy `message` field is empty.
 */
async function mediaFetch<T>(
  url: string,
  options?: RequestInit
): Promise<MediaApiResponse<T>> {
  const response = await authFetch(url, options);

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw parseApiError(json, response.status);
  }

  const json = (await response.json()) as {
    data?: T;
    meta?: Record<string, unknown>;
  };

  return {
    success: true,
    data: json.data,
    meta: json.meta,
    statusCode: response.status,
    message: "",
  };
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
    // Canonical wire shape per spec §10.2: { data: Media }.
    try {
      const response = JSON.parse(result.responseText);
      if (response.data) {
        return response.data as Media;
      }
      throw new Error("Upload succeeded but server returned no data.");
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
  if (params.pageSize) queryParams.set("pageSize", String(params.pageSize));
  if (params.search) queryParams.set("search", params.search);
  if (params.type) queryParams.set("type", params.type);
  if (params.sortBy) queryParams.set("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);
  if (params.folderId) {
    queryParams.set("folderId", params.folderId);
  }

  const result = await mediaFetch<Media[]>(
    `/api/media?${queryParams.toString()}`
  );

  return {
    data: result.data || [],
    meta: (result.meta as MediaListResponse["meta"]) || {
      total: 0,
      page: params.page || 1,
      pageSize: params.pageSize || 24,
      totalPages: 0,
    },
    success: result.success,
    statusCode: result.statusCode ?? 200,
    message: result.message ?? "",
  };
}

/**
 * Fetch a single media item by ID
 */
export async function getMediaById(mediaId: string): Promise<Media> {
  const result = await mediaFetch<Media>(`/api/media/${mediaId}`);
  if (!result.data) {
    throw new Error(result.message || `Media not found: ${mediaId}`);
  }
  return result.data;
}

/**
 * Update media metadata
 */
export async function updateMedia(
  mediaId: string,
  updates: MediaUpdateInput
): Promise<void> {
  await mediaFetch(`/api/media/${mediaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

/**
 * Delete a media item
 */
export async function deleteMedia(mediaId: string): Promise<void> {
  await mediaFetch(`/api/media/${mediaId}`, { method: "DELETE" });
}

/**
 * Bulk delete multiple media files
 */
export async function bulkDeleteMedia(mediaIds: string[]): Promise<{
  success: boolean;
  total: number;
  successCount: number;
  failureCount: number;
  failed: string[];
}> {
  const response = await authFetch("/api/media/bulk", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaIds }),
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw parseApiError(json, response.status);
  }

  // Canonical wire shape per spec §10.2:
  //   { data: { totalFiles, successCount, failureCount, results: [...] } }.
  // The legacy code read the bulk-result fields at the top level, which
  // returned undefined under the canonical shape and silently reported a
  // zero-success false-positive.
  const json = (await response.json()) as {
    data?: {
      totalFiles?: number;
      successCount?: number;
      failureCount?: number;
      results?: Array<{ success: boolean; mediaId: string }>;
    };
  };
  const data = json.data ?? {};

  return {
    success: (data.failureCount ?? 0) === 0,
    total: data.totalFiles ?? mediaIds.length,
    successCount: data.successCount ?? 0,
    failureCount: data.failureCount ?? 0,
    failed: data.results?.filter(r => !r.success).map(r => r.mediaId) ?? [],
  };
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

  const result = await mediaFetch<MediaFolder>("/api/media/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, createdBy: userId }),
  });
  if (!result.data) {
    throw new Error(result.message || "Failed to create folder");
  }
  return result.data;
}

/**
 * Get folder by ID with breadcrumbs
 */
export async function getFolderById(
  folderId: string
): Promise<FolderResponse["data"]> {
  const result = await mediaFetch<FolderResponse["data"]>(
    `/api/media/folders/${folderId}`
  );
  if (!result.data) {
    throw new Error(result.message || `Folder not found: ${folderId}`);
  }
  return result.data;
}

/**
 * List root folders (folders with no parent)
 */
export async function listRootFolders(): Promise<MediaFolder[]> {
  const result = await mediaFetch<MediaFolder[]>(
    "/api/media/folders?root=true"
  );
  return result.data || [];
}

/**
 * List subfolders within a parent folder
 */
export async function listSubfolders(parentId: string): Promise<MediaFolder[]> {
  const result = await mediaFetch<MediaFolder[]>(
    `/api/media/folders?parentId=${parentId}`
  );
  return result.data || [];
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

  const result = await mediaFetch<FolderContentsResponse["data"]>(url);
  if (!result.data) {
    throw new Error(result.message || "Failed to get folder contents");
  }
  return result.data;
}

/**
 * Update folder metadata
 */
export async function updateFolder(
  folderId: string,
  updates: UpdateFolderInput
): Promise<MediaFolder> {
  const result = await mediaFetch<MediaFolder>(
    `/api/media/folders/${folderId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!result.data) {
    throw new Error(result.message || "Failed to update folder");
  }
  return result.data;
}

/**
 * Delete folder
 */
export async function deleteFolder(
  folderId: string,
  deleteContents: boolean = false
): Promise<void> {
  await mediaFetch(
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
  const result = await mediaFetch<Media>(`/api/media/${mediaId}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  return result.data ?? null;
}

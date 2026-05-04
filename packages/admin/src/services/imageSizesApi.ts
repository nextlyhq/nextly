/**
 * Image Sizes API Service
 *
 * Direct API client for managing image size configurations.
 * Backed by `/admin/api/image-sizes` REST endpoints.
 *
 * The list endpoint emits the canonical `respondList` envelope (`{ items, meta }`).
 * The single-doc endpoint emits a bare `respondDoc` body.
 */

import { authFetch } from "@admin/lib/api/refreshInterceptor";

// ============================================================
// Types (matching the backend ImageSize interface)
// ============================================================

export interface ImageSize {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  fit: string;
  quality: number;
  format: string;
  isDefault: boolean;
  sortOrder: number;
}

// ============================================================
// API helpers
// ============================================================

export async function fetchImageSizes(): Promise<ImageSize[]> {
  const res = await authFetch("/admin/api/image-sizes", {
    credentials: "include",
  });
  if (!res.ok) return [];
  // /admin/api/image-sizes emits the canonical respondList envelope
  // (spec section 5.1): `{ items, meta }`.
  const data = (await res.json()) as { items?: ImageSize[] };
  return data.items ?? [];
}

/**
 * Fetch a single image size by id. Returns `null` if the id is unknown
 * (the backend responds 404 with NextlyError.notFound).
 *
 * The single-doc endpoint returns the row bare (respondDoc), so the JSON
 * body itself is the ImageSize.
 */
export async function fetchImageSize(id: string): Promise<ImageSize | null> {
  const res = await authFetch(`/admin/api/image-sizes/${id}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to fetch" }));
    throw new Error(err.error?.message ?? "Failed to fetch image size");
  }
  const data = (await res.json()) as ImageSize;
  return data;
}

export async function createImageSize(
  input: Partial<ImageSize>
): Promise<void> {
  const res = await authFetch("/admin/api/image-sizes", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create" }));
    throw new Error(err.error?.message ?? "Failed to create image size");
  }
}

export async function updateImageSize(
  id: string,
  input: Partial<ImageSize>
): Promise<void> {
  const res = await authFetch(`/admin/api/image-sizes/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to update" }));
    throw new Error(err.error?.message ?? "Failed to update image size");
  }
}

export async function deleteImageSize(id: string): Promise<void> {
  const res = await authFetch(`/admin/api/image-sizes/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to delete" }));
    throw new Error(err.error?.message ?? "Failed to delete image size");
  }
}

/**
 * Media Server Actions
 *
 * Server actions for media operations with integrated authentication.
 * Uses the current user's session to authenticate uploads.
 *
 * ## Usage
 *
 * ```typescript
 * // In a client component
 * 'use client';
 *
 * import { uploadMedia } from '@/app/actions/media';
 *
 * function UploadButton() {
 *   async function handleUpload(formData: FormData) {
 *     const result = await uploadMedia(formData);
 *     if (result.success) {
 *       toast.success('File uploaded!');
 *     } else {
 *       toast.error(result.error || 'Upload failed');
 *     }
 *   }
 *
 *   return (
 *     <form action={handleUpload}>
 *       <input type="file" name="file" />
 *       <button type="submit">Upload</button>
 *     </form>
 *   );
 * }
 * ```
 */

"use server";

import {
  uploadMediaAction,
  deleteMediaAction,
  updateMediaAction,
  type UploadMediaActionResult,
} from "@revnixhq/nextly/actions";
import { cookies } from "next/headers";

/**
 * Get the current user ID from session API
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map(c => `${c.name}=${c.value}`)
      .join("; ");

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });

    if (!response.ok) return null;

    const session = await response.json();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Upload media file (with auth integration)
 *
 * Wraps uploadMediaAction with authentication.
 * Automatically gets the current user ID from the session.
 *
 * @param formData - FormData containing the file
 * @returns Upload result
 *
 * @example
 * ```typescript
 * // In a client component
 * const formData = new FormData();
 * formData.append('file', file);
 * const result = await uploadMedia(formData);
 * if (result.success) {
 *   console.log('Uploaded:', result.data);
 * }
 * ```
 */
export async function uploadMedia(
  formData: FormData
): Promise<UploadMediaActionResult> {
  // Get current user from session
  const userId = await getCurrentUserId();

  if (!userId) {
    return { success: false, error: "Unauthorized", statusCode: 401 };
  }

  // Optional: Add authorization checks
  // Example: if (!hasPermission(userId, 'media.upload')) {
  //   return { success: false, error: 'Forbidden', statusCode: 403 };
  // }

  // Optional: Add file size/type restrictions
  // Example: const file = formData.get('file') as File;
  // if (file.size > 10 * 1024 * 1024) {
  //   return { success: false, error: 'File too large (max 10MB)' };
  // }

  return uploadMediaAction(formData, {
    uploadedBy: userId,
    revalidatePath: "/admin/media", // Customize for your app
  });
}

/**
 * Delete media file (with auth integration)
 *
 * @param mediaId - ID of media to delete
 * @returns Deletion result
 *
 * @example
 * ```typescript
 * const result = await deleteMedia('abc-123');
 * if (result.success) {
 *   toast.success('Media deleted');
 * }
 * ```
 */
export async function deleteMedia(mediaId: string) {
  // Get current user from session
  const userId = await getCurrentUserId();

  if (!userId) {
    return { success: false, error: "Unauthorized", statusCode: 401 };
  }

  // Optional: Check ownership or permissions
  // Example: const media = await getMediaById(mediaId);
  // if (media.uploadedBy !== userId && !isAdmin(userId)) {
  //   return { success: false, error: 'Forbidden', statusCode: 403 };
  // }

  return deleteMediaAction(mediaId, {
    revalidatePath: "/admin/media",
  });
}

/**
 * Update media metadata (with auth integration)
 *
 * @param mediaId - ID of media to update
 * @param updates - Metadata updates
 * @returns Update result
 *
 * @example
 * ```typescript
 * const result = await updateMediaMetadata('abc-123', {
 *   altText: 'Company logo',
 *   caption: 'Our brand identity',
 *   tags: ['branding', 'logo'],
 * });
 * ```
 */
export async function updateMediaMetadata(
  mediaId: string,
  updates: {
    filename?: string;
    altText?: string;
    caption?: string;
    tags?: string[];
  }
) {
  // Get current user from session
  const userId = await getCurrentUserId();

  if (!userId) {
    return { success: false, error: "Unauthorized", statusCode: 401 };
  }

  // Optional: Check ownership or permissions
  // Similar to deleteMedia example above

  return updateMediaAction(mediaId, updates, {
    revalidatePath: "/admin/media",
  });
}

/**
 * Media Upload Server Action
 *
 * Next.js 16 Server Action for uploading media files.
 * Provides a simpler alternative to API routes for small files (<5MB).
 *
 * ## Features
 *
 * - Server-side file upload (no client-side FormData serialization)
 * - Automatic cache revalidation (revalidatePath)
 * - Type-safe with Zod validation
 * - Authentication support (when configured)
 * - Error handling with user-friendly messages
 *
 * ## Usage
 *
 * ### In Consumer's Next.js App
 *
 * ```typescript
 * // app/actions/media.ts
 * 'use server';
 *
 * import { uploadMediaAction } from '@revnixhq/nextly/actions/upload-media';
 * import { getUserId } from './auth'; // Your auth implementation
 *
 * export async function uploadMedia(formData: FormData) {
 *   const userId = await getUserId();
 *   return uploadMediaAction(formData, { uploadedBy: userId });
 * }
 * ```
 *
 * ### In Client Component
 *
 * ```tsx
 * 'use client';
 *
 * import { uploadMedia } from './actions/media';
 *
 * function UploadForm() {
 *   async function handleSubmit(formData: FormData) {
 *     const result = await uploadMedia(formData);
 *     if (result.success) {
 *       toast.success('Uploaded!');
 *     } else {
 *       toast.error(result.error);
 *     }
 *   }
 *
 *   return <form action={handleSubmit}>...</form>;
 * }
 * ```
 *
 * ## Authentication
 *
 * This action is **auth-agnostic** by design. The `uploadedBy` parameter
 * must be provided by the consumer's authentication implementation.
 *
 * Examples:
 * - NextAuth: `const session = await auth(); uploadedBy: session.user.id`
 * - Clerk: `const { userId } = auth(); uploadedBy: userId`
 * - Custom: `const user = await getUser(); uploadedBy: user.id`
 *
 * ## Limitations
 *
 * - **No upload progress**: Server Actions don't support progress events
 * - **Recommended for small files only** (<5MB)
 * - **For large files**: Use API route with XMLHttpRequest
 *
 * @see packages/db/src/api/media.ts - API route with progress support
 * @see MEDIA-MANAGEMENT-EXTENDED-PLAN.md - Phase 6 implementation details
 */

"use server";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { container } from "../di/container";
import { ServiceContainer } from "../services";
import type { Media } from "../types/media";
import { UploadMediaInputSchema } from "../types/media";

function getServices(): ServiceContainer {
  const adapter = container.get("adapter") as DrizzleAdapter;
  return new ServiceContainer(adapter);
}

/**
 * Server Action options
 */
export interface UploadMediaActionOptions {
  /**
   * User ID who is uploading the file (required)
   * Must be obtained from your auth system
   */
  uploadedBy: string;

  /**
   * Path to revalidate after successful upload
   * @default '/admin/media'
   */
  revalidatePath?: string;
}

/**
 * Server Action result
 */
export interface UploadMediaActionResult {
  success: boolean;
  data?: Media;
  error?: string;
  statusCode?: number;
}

/**
 * Upload media file via Server Action
 *
 * Uploads a file to storage and creates a database record.
 * Automatically generates thumbnails for images.
 *
 * @param formData - FormData containing the file
 * @param options - Upload options (uploadedBy, revalidatePath)
 * @returns Upload result with media data or error
 *
 * @example Basic usage
 * ```typescript
 * 'use server';
 *
 * export async function uploadFile(formData: FormData) {
 *   const userId = await getUserId(); // Your auth function
 *   return uploadMediaAction(formData, { uploadedBy: userId });
 * }
 * ```
 *
 * @example With custom revalidation path
 * ```typescript
 * return uploadMediaAction(formData, {
 *   uploadedBy: userId,
 *   revalidatePath: '/dashboard/gallery',
 * });
 * ```
 */
export async function uploadMediaAction(
  formData: FormData,
  options: UploadMediaActionOptions
): Promise<UploadMediaActionResult> {
  try {
    // 1. Extract file from FormData
    const file = formData.get("file") as File | null;

    if (!file) {
      return {
        success: false,
        error: "No file provided",
        statusCode: 400,
      };
    }

    // 2. Validate file
    if (!(file instanceof File)) {
      return {
        success: false,
        error: "Invalid file",
        statusCode: 400,
      };
    }

    // 3. Convert to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. Validate input
    const parseResult = UploadMediaInputSchema.safeParse({
      file: buffer,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      uploadedBy: options.uploadedBy,
    });

    if (!parseResult.success) {
      const errors = parseResult.error.issues;
      const firstError = errors[0];
      return {
        success: false,
        error: firstError?.message || "Invalid file data",
        statusCode: 400,
      };
    }

    // 5. Upload via MediaService
    const services = getServices();
    const result = await services.media.uploadMedia(parseResult.data);

    // 6. Revalidate cache on success.
    // `next/cache` is dynamically imported to dodge the bundler/Node-ESM
    // resolution split (see with-error-handler.ts for the full rationale).
    if (result.success && result.data) {
      const pathToRevalidate = options.revalidatePath || "/admin/media";
      const { revalidatePath } = (await import("next/cache")) as {
        revalidatePath: (path: string) => void;
      };
      revalidatePath(pathToRevalidate);

      return {
        success: true,
        data: result.data,
        statusCode: result.statusCode,
      };
    }

    // 7. Handle service errors
    return {
      success: false,
      error: result.message || "Upload failed",
      statusCode: result.statusCode,
    };
  } catch (error) {
    // 8. Handle unexpected errors
    console.error("[uploadMediaAction] Unexpected error:", error);

    return {
      success: false,
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
      statusCode: 500,
    };
  }
}

/**
 * Delete media file via Server Action
 *
 * Deletes a file from storage and removes the database record.
 *
 * @param mediaId - ID of media to delete
 * @param options - Options (revalidatePath)
 * @returns Deletion result
 *
 * @example
 * ```typescript
 * 'use server';
 *
 * export async function deleteFile(mediaId: string) {
 *   return deleteMediaAction(mediaId);
 * }
 * ```
 */
export async function deleteMediaAction(
  mediaId: string,
  options?: { revalidatePath?: string }
): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    // 1. Validate input
    if (!mediaId || typeof mediaId !== "string") {
      return {
        success: false,
        error: "Invalid media ID",
        statusCode: 400,
      };
    }

    // 2. Delete via MediaService
    const services = getServices();
    const result = await services.media.deleteMedia(mediaId);

    // 3. Revalidate cache on success (dynamic import — see above)
    if (result.success) {
      const pathToRevalidate = options?.revalidatePath || "/admin/media";
      const { revalidatePath } = (await import("next/cache")) as {
        revalidatePath: (path: string) => void;
      };
      revalidatePath(pathToRevalidate);

      return {
        success: true,
        statusCode: result.statusCode,
      };
    }

    // 4. Handle service errors
    return {
      success: false,
      error: result.message || "Delete failed",
      statusCode: result.statusCode,
    };
  } catch (error) {
    console.error("[deleteMediaAction] Unexpected error:", error);

    return {
      success: false,
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
      statusCode: 500,
    };
  }
}

/**
 * Update media metadata via Server Action
 *
 * Updates altText, caption, tags, or other metadata fields.
 *
 * @param mediaId - ID of media to update
 * @param updates - Metadata updates
 * @param options - Options (revalidatePath)
 * @returns Update result
 *
 * @example
 * ```typescript
 * 'use server';
 *
 * export async function updateFile(
 *   mediaId: string,
 *   updates: { altText?: string; caption?: string; tags?: string[] }
 * ) {
 *   return updateMediaAction(mediaId, updates);
 * }
 * ```
 */
export async function updateMediaAction(
  mediaId: string,
  updates: {
    filename?: string;
    altText?: string;
    caption?: string;
    tags?: string[];
  },
  options?: { revalidatePath?: string }
): Promise<{
  success: boolean;
  data?: Media;
  error?: string;
  statusCode?: number;
}> {
  try {
    // 1. Validate input
    if (!mediaId || typeof mediaId !== "string") {
      return {
        success: false,
        error: "Invalid media ID",
        statusCode: 400,
      };
    }

    // 2. Update via MediaService
    const services = getServices();
    const result = await services.media.updateMedia(mediaId, updates);

    // 3. Revalidate cache on success (dynamic import — see above)
    if (result.success && result.data) {
      const pathToRevalidate = options?.revalidatePath || "/admin/media";
      const { revalidatePath } = (await import("next/cache")) as {
        revalidatePath: (path: string) => void;
      };
      revalidatePath(pathToRevalidate);

      return {
        success: true,
        data: result.data,
        statusCode: result.statusCode,
      };
    }

    // 4. Handle service errors
    return {
      success: false,
      error: result.message || "Update failed",
      statusCode: result.statusCode,
    };
  } catch (error) {
    console.error("[updateMediaAction] Unexpected error:", error);

    return {
      success: false,
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
      statusCode: 500,
    };
  }
}

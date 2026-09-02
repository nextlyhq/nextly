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
 * import { uploadMediaAction } from 'nextly/actions/upload-media';
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
 * - Nextly: `const result = await getSession(request, secret); uploadedBy: result.user?.id`
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

import { createRequire } from "node:module";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../di/container";
import { ServiceContainer } from "../services";
import { UploadValidator } from "../services/upload-validation";
import type { SecurityBlockLike } from "../services/upload-validation";
import { resolveClaimedMimeType } from "../services/upload-validation/mime";
import type { Media, MediaResponse } from "../types/media";
import { UploadMediaInputSchema } from "../types/media";

// `next/cache` resolved via createRequire — see api/with-error-handler.ts
// for the dual-resolution rationale (Node ESM vs Turbopack). Cached at
// module scope; resolution happens on first call only.
type RevalidatePath = (path: string) => void;
let cachedRevalidatePath: RevalidatePath | null = null;
function getRevalidatePath(): RevalidatePath {
  if (cachedRevalidatePath) return cachedRevalidatePath;
  const require = createRequire(import.meta.url);
  const mod = require("next/cache") as { revalidatePath: RevalidatePath };
  cachedRevalidatePath = mod.revalidatePath;
  return cachedRevalidatePath;
}

function getServices(): ServiceContainer {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const adapter = container.get("adapter") as DrizzleAdapter;
  return new ServiceContainer(adapter);
}

/**
 * Turn a media service result into an action result, revalidating the listing
 * when the write succeeded.
 *
 * Upload and update answer identically here, and a second copy drifts from the
 * first as soon as either changes what a success returns — so both ask this.
 *
 * @param result - What the service reported
 * @param revalidatePath - Caller's override for the path to revalidate
 * @param failureMessage - Fallback text when the service reported none
 */
function settleMediaWrite(
  result: MediaResponse,
  revalidatePath: string | undefined,
  failureMessage: string
): UploadMediaActionResult {
  if (result.success && result.data) {
    getRevalidatePath()(revalidatePath || "/admin/media");
    return {
      success: true,
      data: result.data,
      statusCode: result.statusCode,
    };
  }

  return {
    success: false,
    error: result.message || failureMessage,
    statusCode: result.statusCode,
  };
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
    /*
     * A browser reports no type for formats its platform does not register,
     * fonts among them, so the name fills it in. Only a known font name
     * resolves and the claim still meets the magic-byte check downstream, so
     * this narrows what a caller must send rather than widening what is
     * believed.
     */
    const claimedMimeType = resolveClaimedMimeType(
      file.name,
      file.type,
      buffer
    );

    /*
     * 5. The CONFIGURED validator, before anything is stored.
     *
     * `ServiceContainer.media` is the legacy service, which never runs it — so
     * this path enforced no allowlist, no magic-byte comparison and no
     * sanitisation, while the mounted REST handler enforced all three. An
     * install excluding a format through `security.uploads` had that policy
     * apply to one entry point and not this one, and what lands here becomes
     * anonymously retrievable through the byte route.
     *
     * Built the way `register-media` builds it, from the same config, so the
     * two paths cannot answer differently.
     */
    const securityConfig = container.has("config")
      ? container.get<{ security?: SecurityBlockLike }>("config")?.security
      : undefined;
    const validation = await new UploadValidator(securityConfig).validate({
      buffer,
      filename: file.name,
      mimeType: claimedMimeType,
    });
    if (!validation.ok) {
      // The public message only. `logContext` carries the sniffed type and the
      // sizes, which are operator detail and never travel to a caller.
      return {
        success: false,
        error: validation.errors[0]?.message ?? "Upload rejected.",
        statusCode: 400,
      };
    }

    /*
     * 6. What gets stored is the validator's OUTPUT, never its input.
     *
     * For an SVG those differ: `value.buffer` is the sanitized document, and
     * persisting the original would compute the safe copy and then throw it
     * away. The size travels from the same buffer for the same reason — the
     * row has to describe the bytes that were actually written, and
     * sanitisation changes their length.
     *
     * `svgCsp` is resolved as `register-media` resolves it, so a sanitized
     * SVG is served as an attachment on this path too rather than rendering
     * in the origin on direct navigation.
     */
    const validated = validation.value;
    const svgCsp = securityConfig?.uploads?.svgCsp ?? true;

    const parseResult = UploadMediaInputSchema.safeParse({
      file: validated.buffer,
      filename: validated.filename,
      mimeType: validated.mimeType,
      size: validated.buffer.length,
      uploadedBy: options.uploadedBy,
      ...(validated.isSvg && svgCsp && { contentDisposition: "attachment" }),
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

    // 7. Upload via MediaService
    const services = getServices();
    const result = await services.media.uploadMedia(parseResult.data);

    // 8. Revalidate on success, and map whatever the service reported.
    return settleMediaWrite(result, options.revalidatePath, "Upload failed");
  } catch (error) {
    // 9. Handle unexpected errors
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

    // 3. Revalidate cache via createRequire-resolved next/cache.
    if (result.success) {
      const pathToRevalidate = options?.revalidatePath || "/admin/media";
      getRevalidatePath()(pathToRevalidate);

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

    // 3. Revalidate on success, and map whatever the service reported.
    return settleMediaWrite(result, options?.revalidatePath, "Update failed");
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

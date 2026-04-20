/**
 * Server Actions for Nextly
 *
 * Next.js 16 Server Actions for common CMS operations.
 * These can be re-exported in your Next.js application.
 *
 * ## Usage Pattern
 *
 * ### 1. Create wrapper actions in your app
 *
 * ```typescript
 * // app/actions/media.ts
 * 'use server';
 *
 * import { uploadMediaAction } from '@revnixhq/nextly/actions';
 * import { auth } from '@/lib/auth'; // Your auth
 *
 * export async function uploadMedia(formData: FormData) {
 *   const session = await auth();
 *   if (!session?.user?.id) {
 *     return { success: false, error: 'Unauthorized' };
 *   }
 *
 *   return uploadMediaAction(formData, {
 *     uploadedBy: session.user.id,
 *   });
 * }
 * ```
 *
 * ### 2. Use in client components
 *
 * ```tsx
 * 'use client';
 *
 * import { uploadMedia } from '@/app/actions/media';
 *
 * function UploadButton() {
 *   async function handleUpload(formData: FormData) {
 *     const result = await uploadMedia(formData);
 *     if (result.success) {
 *       toast.success('Uploaded!');
 *     }
 *   }
 *
 *   return <form action={handleUpload}>...</form>;
 * }
 * ```
 *
 * ## Available Actions
 *
 * ### Media Actions
 * - `uploadMediaAction` - Upload file to storage
 * - `deleteMediaAction` - Delete file from storage
 * - `updateMediaAction` - Update file metadata
 *
 * @see packages/nextly/src/actions/upload-media.ts
 * @module actions
 */

export {
  uploadMediaAction,
  deleteMediaAction,
  updateMediaAction,
  type UploadMediaActionOptions,
  type UploadMediaActionResult,
} from "./upload-media";

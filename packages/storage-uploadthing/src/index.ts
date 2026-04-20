/**
 * @revnixhq/storage-uploadthing
 *
 * Uploadthing storage adapter for Nextly CMS.
 * Stores files on Uploadthing's cloud storage with CDN delivery.
 *
 * @example
 * ```typescript
 * import { uploadthingStorage } from '@revnixhq/storage-uploadthing'
 *
 * export default defineConfig({
 *   storage: [
 *     uploadthingStorage({
 *       token: process.env.UPLOADTHING_TOKEN,
 *       collections: { media: true }
 *     })
 *   ]
 * })
 * ```
 */

export { uploadthingStorage } from "./plugin";
export { UploadthingStorageAdapter } from "./adapter";
export type { UploadthingStorageConfig } from "./types";

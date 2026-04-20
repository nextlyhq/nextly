/**
 * Local Disk Storage Types
 *
 * Configuration for the local filesystem storage adapter.
 * Used as the default storage for development when no cloud env vars are set.
 */

import type { StoragePluginConfig } from "../types";

/**
 * Local disk storage adapter configuration.
 *
 * @example Default (zero-config)
 * ```typescript
 * localStorage({ collections: { media: true } })
 * ```
 *
 * @example Custom paths
 * ```typescript
 * localStorage({
 *   basePath: './public/media',
 *   baseUrl: '/media',
 *   collections: { media: true }
 * })
 * ```
 */
export interface LocalStorageConfig extends StoragePluginConfig {
  /**
   * Directory to store uploaded files.
   * Relative to the project root or absolute path.
   *
   * @default './public/uploads'
   */
  basePath?: string;

  /**
   * Base URL prefix for serving files via Next.js static file serving.
   * Files in `public/uploads/` are served at `/uploads/...` by Next.js.
   *
   * @default '/uploads'
   */
  baseUrl?: string;
}

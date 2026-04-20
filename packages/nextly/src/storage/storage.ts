/**
 * Unified Media Storage Manager
 *
 * Manages storage adapters and routes uploads to appropriate backends
 * based on collection configuration. Supports:
 * - AWS S3 / Cloudflare R2 / MinIO (via @revnixhq/plugin-storage-s3)
 * - Vercel Blob (via @revnixhq/plugin-storage-vercel-blob)
 * - Collection-specific storage routing
 *
 * @example With Vercel Blob storage (configured in nextly.config.ts)
 * ```typescript
 * import { vercelBlobStorage } from '@revnixhq/plugin-storage-vercel-blob';
 *
 * export default defineConfig({
 *   storage: [
 *     vercelBlobStorage({
 *       collections: { media: true }
 *     })
 *   ]
 * });
 * ```
 *
 * @example With S3 storage (configured in nextly.config.ts)
 * ```typescript
 * import { s3Storage } from '@revnixhq/plugin-storage-s3';
 *
 * export default defineConfig({
 *   storage: [
 *     s3Storage({
 *       bucket: process.env.S3_BUCKET!,
 *       region: process.env.AWS_REGION!,
 *       collections: {
 *         media: true,
 *         'private-docs': {
 *           prefix: 'private/',
 *           signedDownloads: true,
 *           clientUploads: true
 *         }
 *       }
 *     })
 *   ]
 * });
 * ```
 */

import { LocalStorageAdapter } from "./adapters/local-adapter";
import type {
  BulkDeleteResult,
  ClientUploadData,
  CollectionStorageConfig,
  IStorageAdapter,
  StoragePlugin,
  UploadOptions,
  UploadResult,
} from "./types";

// ============================================================
// Configuration Interface
// ============================================================

/**
 * Configuration for MediaStorage initialization.
 */
export interface MediaStorageConfig {
  /**
   * Storage plugins from config.
   * Each plugin provides an adapter for specific collections.
   *
   * @example
   * ```typescript
   * plugins: [
   *   s3Storage({ bucket: '...', collections: { media: true } }),
   *   vercelBlobStorage({ collections: { videos: true } })
   * ]
   * ```
   */
  plugins?: StoragePlugin[];

  /**
   * Local storage configuration.
   * Used as the default fallback when no cloud plugins are configured.
   *
   * @example
   * ```typescript
   * local: {
   *   uploadDir: './public/uploads',
   *   publicPath: '/uploads',
   * }
   * ```
   */
  local?: {
    /** Directory to store uploaded files (default: ./public/uploads) */
    uploadDir?: string;
    /** URL path prefix for serving files (default: /uploads) */
    publicPath?: string;
  };
}

// ============================================================
// MediaStorage Class
// ============================================================

/**
 * Unified Media Storage Manager.
 *
 * Routes uploads to appropriate storage backends based on collection
 * configuration. Supports plugin-based storage adapters for cloud
 * providers (S3, Vercel Blob) with collection-specific routing.
 *
 * Features:
 * - Plugin-based cloud storage (S3, Vercel Blob)
 * - Collection-specific routing
 * - Client-side upload URL generation
 * - Signed download URLs
 */
export class MediaStorage {
  /** Registered storage plugins by name */
  private plugins: Map<string, StoragePlugin> = new Map();

  /** Storage adapter per collection */
  private collectionAdapters: Map<string, IStorageAdapter> = new Map();

  /** Storage configuration per collection */
  private collectionConfigs: Map<string, CollectionStorageConfig> = new Map();

  /** Local storage adapter (always available as fallback) */
  private localAdapter: IStorageAdapter;

  /**
   * Create a new MediaStorage instance.
   *
   * @param config - Optional configuration for storage initialization
   */
  constructor(config?: MediaStorageConfig) {
    // Always create local adapter as the fallback
    this.localAdapter = new LocalStorageAdapter({
      basePath: config?.local?.uploadDir ?? "./public/uploads",
      baseUrl: config?.local?.publicPath ?? "/uploads",
    });

    // Register plugins if provided
    if (config?.plugins) {
      for (const plugin of config.plugins) {
        this.registerPlugin(plugin);
      }
    }
  }

  // ============================================================
  // Plugin Registration
  // ============================================================

  /**
   * Register a storage plugin.
   *
   * Plugins provide storage adapters for specific collections.
   * When a collection is registered with a plugin, uploads for that
   * collection will be routed to the plugin's adapter.
   *
   * @param plugin - The storage plugin to register
   *
   * @example
   * ```typescript
   * const storage = new MediaStorage();
   *
   * storage.registerPlugin(s3Storage({
   *   bucket: 'my-bucket',
   *   region: 'us-east-1',
   *   collections: {
   *     media: true,
   *     'private-docs': { prefix: 'private/' }
   *   }
   * }));
   * ```
   */
  registerPlugin(plugin: StoragePlugin): void {
    // Skip disabled plugins (adapter will be null)
    if (!plugin.adapter) {
      return;
    }

    this.plugins.set(plugin.name, plugin);

    // Map collections to their adapters and configs
    for (const [collectionSlug, config] of Object.entries(plugin.collections)) {
      const collectionConfig: CollectionStorageConfig =
        typeof config === "boolean" ? {} : config;

      this.collectionAdapters.set(collectionSlug, plugin.adapter);
      this.collectionConfigs.set(collectionSlug, collectionConfig);
    }
  }

  // ============================================================
  // Adapter Resolution
  // ============================================================

  /**
   * Check if any storage adapter is configured.
   *
   * @returns True if at least one storage plugin is registered
   */
  hasAdapter(): boolean {
    // Always true — local adapter is always available
    return true;
  }

  /**
   * Get the storage adapter if available, or null if not configured.
   *
   * Unlike getAdapter(), this method does not throw an error if no storage
   * is configured. Useful for optional storage scenarios.
   *
   * @param collection - The collection slug (optional)
   * @returns The storage adapter instance, or null if not configured
   */
  getAdapterOrNull(collection?: string): IStorageAdapter | null {
    if (collection && this.collectionAdapters.has(collection)) {
      return this.collectionAdapters.get(collection)!;
    }
    return this.localAdapter;
  }

  /**
   * Get the storage adapter for a specific collection.
   *
   * If a plugin is configured for the collection, returns the plugin's adapter.
   * Otherwise, returns the default adapter (first registered plugin).
   *
   * @param collection - The collection slug (optional)
   * @returns The appropriate storage adapter
   * @throws Error if no storage plugin is configured
   */
  getAdapterForCollection(collection?: string): IStorageAdapter {
    if (collection && this.collectionAdapters.has(collection)) {
      return this.collectionAdapters.get(collection)!;
    }

    // Fall back to local storage adapter (always available)
    return this.localAdapter;
  }

  /**
   * Get configuration for a specific collection.
   *
   * @param collection - The collection slug
   * @returns The collection's storage configuration, or undefined
   */
  getCollectionConfig(collection: string): CollectionStorageConfig | undefined {
    return this.collectionConfigs.get(collection);
  }

  // ============================================================
  // Core Storage Operations
  // ============================================================

  /**
   * Upload file to appropriate storage based on collection.
   *
   * Routes the upload to the correct adapter based on collection
   * configuration. Applies collection-specific prefix if configured.
   *
   * @param buffer - The file buffer to upload
   * @param options - Upload options including filename, mimeType, collection
   * @returns Upload result with URL and path
   *
   * @example
   * ```typescript
   * const result = await storage.upload(buffer, {
   *   filename: 'photo.jpg',
   *   mimeType: 'image/jpeg',
   *   collection: 'media'
   * });
   * console.log(result.url); // Public URL
   * console.log(result.path); // Storage path for deletion
   * ```
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const adapter = this.getAdapterForCollection(options.collection);
    const config = options.collection
      ? this.getCollectionConfig(options.collection)
      : undefined;

    // Apply collection prefix if configured
    const uploadOptions = { ...options };
    if (config?.prefix) {
      uploadOptions.folder = config.prefix + (options.folder || "");
    }

    return adapter.upload(buffer, uploadOptions);
  }

  /**
   * Delete file from storage.
   *
   * Determines correct adapter based on collection.
   *
   * @param filePath - The storage path/key of the file
   * @param collection - The collection slug (optional, for routing)
   */
  async delete(filePath: string, collection?: string): Promise<void> {
    const adapter = this.getAdapterForCollection(collection);
    return adapter.delete(filePath);
  }

  /**
   * Bulk delete files from storage.
   * Uses adapter's native bulkDelete if available, otherwise falls back to
   * sequential individual deletes in chunks of 10.
   */
  async bulkDelete(
    filePaths: string[],
    collection?: string
  ): Promise<BulkDeleteResult> {
    const adapter = this.getAdapterForCollection(collection);

    if (adapter.bulkDelete) {
      return adapter.bulkDelete(filePaths);
    }

    // Fallback: sequential deletes in chunks of 10
    const successful: string[] = [];
    const failed: Array<{ filePath: string; error: string }> = [];
    const chunkSize = 10;

    for (let i = 0; i < filePaths.length; i += chunkSize) {
      const chunk = filePaths.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map(fp => adapter.delete(fp))
      );

      results.forEach((result, idx) => {
        const fp = chunk[idx];
        if (result.status === "fulfilled") {
          successful.push(fp);
        } else {
          failed.push({
            filePath: fp,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      });
    }

    return { successful, failed };
  }

  /**
   * Check if file exists in storage.
   *
   * @param filePath - The storage path/key to check
   * @param collection - The collection slug (optional, for routing)
   * @returns True if file exists
   */
  async exists(filePath: string, collection?: string): Promise<boolean> {
    const adapter = this.getAdapterForCollection(collection);
    return adapter.exists(filePath);
  }

  /**
   * Get public URL for file.
   *
   * @param filePath - The storage path/key
   * @param collection - The collection slug (optional, for routing)
   * @returns Public URL to access the file
   */
  getPublicUrl(filePath: string, collection?: string): string {
    const adapter = this.getAdapterForCollection(collection);
    return adapter.getPublicUrl(filePath);
  }

  /**
   * Get storage type for a collection.
   *
   * @param collection - The collection slug (optional)
   * @returns Storage type identifier ('s3', 'vercel-blob')
   */
  getStorageType(collection?: string): string {
    const adapter = this.getAdapterForCollection(collection);
    return adapter.getType();
  }

  // ============================================================
  // Client Upload Support
  // ============================================================

  /**
   * Check if collection supports client-side uploads.
   *
   * Client-side uploads allow direct-to-storage uploads, bypassing
   * the server. This is essential for serverless platforms with
   * request body size limits (e.g., Vercel's 4.5MB limit).
   *
   * @param collection - The collection slug
   * @returns True if client uploads are enabled and supported
   */
  supportsClientUploads(collection: string): boolean {
    const config = this.getCollectionConfig(collection);
    if (!config?.clientUploads) return false;

    const adapter = this.getAdapterForCollection(collection);
    const info = adapter.getInfo?.();
    return info?.supportsClientUploads ?? false;
  }

  /**
   * Get client upload URL for direct-to-storage uploads.
   *
   * Generates a pre-signed URL that allows the client to upload
   * directly to the storage backend, bypassing the server.
   *
   * Only available if:
   * 1. Collection is configured with `clientUploads: true`
   * 2. The storage adapter supports client uploads
   *
   * @param filename - Original filename
   * @param mimeType - File MIME type
   * @param collection - Collection slug
   * @returns Client upload data, or null if not supported
   *
   * @example
   * ```typescript
   * // Server-side: generate upload URL
   * const uploadData = await storage.getClientUploadUrl(
   *   'photo.jpg',
   *   'image/jpeg',
   *   'media'
   * );
   *
   * // Client-side: upload directly to storage
   * await fetch(uploadData.uploadUrl, {
   *   method: uploadData.method,
   *   headers: uploadData.headers,
   *   body: file
   * });
   * ```
   */
  async getClientUploadUrl(
    filename: string,
    mimeType: string,
    collection: string
  ): Promise<ClientUploadData | null> {
    if (!this.supportsClientUploads(collection)) {
      return null;
    }

    // Find the plugin for this collection
    for (const plugin of this.plugins.values()) {
      if (collection in plugin.collections && plugin.getClientUploadUrl) {
        return plugin.getClientUploadUrl(filename, mimeType, collection);
      }
    }

    return null;
  }

  // ============================================================
  // Signed Download Support
  // ============================================================

  /**
   * Check if collection supports signed download URLs.
   *
   * @param collection - The collection slug
   * @returns True if signed downloads are enabled and supported
   */
  supportsSignedDownloads(collection: string): boolean {
    const config = this.getCollectionConfig(collection);
    if (!config?.signedDownloads) return false;

    const adapter = this.getAdapterForCollection(collection);
    const info = adapter.getInfo?.();
    return info?.supportsSignedUrls ?? false;
  }

  /**
   * Get signed download URL for secure file access.
   *
   * Generates a time-limited signed URL for accessing files in
   * private storage buckets. Only works if:
   * 1. Collection is configured with `signedDownloads: true`
   * 2. The storage adapter supports signed URLs
   *
   * @param filePath - Storage path/key of the file
   * @param collection - Collection slug
   * @param expiresIn - URL expiry time in seconds (optional)
   * @returns Signed URL, or null if not supported
   *
   * @example
   * ```typescript
   * const signedUrl = await storage.getSignedDownloadUrl(
   *   'private/doc.pdf',
   *   'private-docs',
   *   3600 // 1 hour
   * );
   * ```
   */
  async getSignedDownloadUrl(
    filePath: string,
    collection: string,
    expiresIn?: number
  ): Promise<string | null> {
    if (!this.supportsSignedDownloads(collection)) {
      return null;
    }

    const config = this.getCollectionConfig(collection);

    // Find the plugin for this collection
    for (const plugin of this.plugins.values()) {
      if (collection in plugin.collections && plugin.getSignedDownloadUrl) {
        return plugin.getSignedDownloadUrl(
          filePath,
          expiresIn ?? config?.signedUrlExpiresIn ?? 3600
        );
      }
    }

    return null;
  }

  // ============================================================
  // Accessor Methods
  // ============================================================

  /**
   * Get the default storage adapter.
   *
   * @returns The default storage adapter (first registered plugin)
   * @throws Error if no storage plugin is configured
   */
  getDefaultAdapter(): IStorageAdapter {
    return this.localAdapter;
  }

  /**
   * Get list of registered plugins.
   *
   * @returns Array of registered storage plugins
   */
  getPlugins(): StoragePlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get the underlying storage adapter for a collection.
   *
   * Useful for passing to registerServices() which requires IStorageAdapter.
   *
   * @param collection - The collection slug (optional)
   * @returns The storage adapter instance
   */
  getAdapter(collection?: string): IStorageAdapter {
    return this.getAdapterForCollection(collection);
  }

  /**
   * Check if a collection has a configured storage adapter.
   *
   * @param collection - The collection slug
   * @returns True if a plugin is configured for this collection
   */
  hasCollectionAdapter(collection: string): boolean {
    return this.collectionAdapters.has(collection);
  }

  /**
   * Get list of collections with configured storage.
   *
   * @returns Array of collection slugs that have plugin storage
   */
  getConfiguredCollections(): string[] {
    return Array.from(this.collectionAdapters.keys());
  }

  /**
   * Check if any storage plugin is configured.
   *
   * @returns True if at least one storage plugin is registered
   */
  hasPlugins(): boolean {
    return this.plugins.size > 0;
  }
}

// ============================================================
// Singleton Management
// ============================================================

let storageInstance: MediaStorage | null = null;

/**
 * Initialize the global MediaStorage instance with plugins.
 *
 * Called during Nextly initialization to set up storage with
 * configured plugins from nextly.config.ts.
 *
 * @param config - Storage configuration with plugins
 * @returns The initialized MediaStorage instance
 *
 * @example
 * ```typescript
 * // In Nextly initialization
 * import { initializeMediaStorage } from '@revnixhq/nextly/storage';
 *
 * const storage = initializeMediaStorage({
 *   plugins: config.storage, // From nextly.config.ts
 * });
 * ```
 */
export function initializeMediaStorage(
  config?: MediaStorageConfig
): MediaStorage {
  storageInstance = new MediaStorage(config);
  return storageInstance;
}

/**
 * Get the global MediaStorage instance.
 *
 * Returns the initialized MediaStorage singleton. If not yet initialized,
 * creates a new instance without plugins (which will throw errors on upload).
 *
 * @returns The MediaStorage instance
 *
 * @example
 * ```typescript
 * import { getMediaStorage } from '@revnixhq/nextly/storage';
 *
 * const storage = getMediaStorage();
 * const result = await storage.upload(buffer, {
 *   filename: 'photo.jpg',
 *   mimeType: 'image/jpeg',
 *   collection: 'media'
 * });
 * ```
 */
export function getMediaStorage(): MediaStorage {
  if (!storageInstance) {
    storageInstance = new MediaStorage();
  }
  return storageInstance;
}

/**
 * Reset storage singleton.
 *
 * Clears the cached MediaStorage instance. Useful for testing
 * or when re-initializing with different configuration.
 *
 * @example
 * ```typescript
 * // In tests
 * beforeEach(() => {
 *   resetMediaStorage();
 * });
 * ```
 */
export function resetMediaStorage(): void {
  storageInstance = null;
}

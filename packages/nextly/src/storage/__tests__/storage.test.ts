/**
 * MediaStorage Integration Tests
 *
 * Tests for MediaStorage plugin-based architecture:
 * - Default local storage
 * - Plugin registration
 * - Collection-specific routing
 * - Client upload URL generation
 * - Signed download URLs
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  MediaStorage,
  getMediaStorage,
  resetMediaStorage,
  initializeMediaStorage,
} from "../storage";
import type {
  CollectionStorageConfig,
  IStorageAdapter,
  StoragePlugin,
  StorageAdapterInfo,
} from "../types";

// Mock LocalStorageAdapter
vi.mock("../adapters/local-adapter", () => ({
  LocalStorageAdapter: vi.fn(function (this: any, config: any) {
    this.config = config;
    this.upload = vi
      .fn()
      .mockResolvedValue({ url: "/uploads/test.jpg", path: "test.jpg" });
    this.delete = vi.fn().mockResolvedValue(undefined);
    this.exists = vi.fn().mockResolvedValue(true);
    this.getPublicUrl = vi.fn().mockReturnValue("/uploads/test.jpg");
    this.getType = vi.fn().mockReturnValue("local");
    this.getInfo = vi.fn().mockReturnValue({
      type: "local",
      name: "LocalStorageAdapter",
      supportsSignedUrls: false,
      supportsClientUploads: false,
    });
    return this;
  }),
}));

/**
 * Create a mock storage adapter for testing
 */
function createMockAdapter(
  type: string,
  options?: { supportsSignedUrls?: boolean; supportsClientUploads?: boolean }
): IStorageAdapter {
  return {
    upload: vi.fn().mockResolvedValue({
      url: `https://${type}.test/file.jpg`,
      path: "file.jpg",
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    getPublicUrl: vi.fn(path => `https://${type}.test/${path}`),
    getType: vi.fn().mockReturnValue(type),
    getInfo: vi.fn().mockReturnValue({
      type,
      name: `${type}Adapter`,
      supportsSignedUrls: options?.supportsSignedUrls ?? false,
      supportsClientUploads: options?.supportsClientUploads ?? false,
    } as StorageAdapterInfo),
  };
}

/**
 * Create a mock storage plugin for testing
 */
function createMockPlugin(
  name: string,
  type: string,
  collections: Record<string, boolean | CollectionStorageConfig>,
  options?: {
    supportsSignedUrls?: boolean;
    supportsClientUploads?: boolean;
  }
): StoragePlugin {
  const adapter = createMockAdapter(type, options);
  return {
    name,
    type: type as any,
    collections,
    adapter,
    getClientUploadUrl: options?.supportsClientUploads
      ? vi.fn().mockResolvedValue({
          uploadUrl: `https://${type}.test/presigned`,
          path: "uploads/file.jpg",
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          expiresAt: new Date(Date.now() + 3600000),
        })
      : undefined,
    getSignedDownloadUrl: options?.supportsSignedUrls
      ? vi.fn().mockResolvedValue(`https://${type}.test/signed/file.jpg`)
      : undefined,
  };
}

describe("MediaStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMediaStorage();
  });

  afterEach(() => {
    resetMediaStorage();
  });

  describe("Default Local Storage", () => {
    it("should use local storage by default", () => {
      const storage = new MediaStorage();

      expect(storage.getStorageType()).toBe("local");
    });

    it("should accept custom local storage config", () => {
      const storage = new MediaStorage({
        local: {
          uploadDir: "/custom/uploads",
          publicPath: "/media",
        },
      });

      expect(storage.getStorageType()).toBe("local");
    });
  });

  describe("Plugin Registration", () => {
    it("should register a plugin", () => {
      const storage = new MediaStorage();
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });

      storage.registerPlugin(plugin);

      expect(storage.getPlugins()).toHaveLength(1);
      expect(storage.getPlugins()[0].name).toBe("s3-plugin");
    });

    it("should skip disabled plugins (null adapter)", () => {
      const storage = new MediaStorage();
      const plugin: StoragePlugin = {
        name: "disabled-plugin",
        type: "s3",
        collections: { media: true },
        adapter: null as any, // Disabled
      };

      storage.registerPlugin(plugin);

      expect(storage.getPlugins()).toHaveLength(0);
    });

    it("should register plugins via constructor", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });

      const storage = new MediaStorage({
        plugins: [plugin],
      });

      expect(storage.getPlugins()).toHaveLength(1);
    });

    it("should map collections to adapters", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", {
        media: true,
        documents: { prefix: "docs/" },
      });

      const storage = new MediaStorage({ plugins: [plugin] });

      expect(storage.hasCollectionAdapter("media")).toBe(true);
      expect(storage.hasCollectionAdapter("documents")).toBe(true);
      expect(storage.hasCollectionAdapter("other")).toBe(false);
    });
  });

  describe("Collection-Specific Routing", () => {
    it("should route uploads to correct adapter based on collection", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });
      const buffer = Buffer.from("test");

      await storage.upload(buffer, {
        filename: "test.jpg",
        mimeType: "image/jpeg",
        collection: "media",
      });

      expect(plugin.adapter.upload).toHaveBeenCalled();
    });

    it("should use default adapter for unconfigured collections", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });
      const buffer = Buffer.from("test");

      // Upload to a collection not in the plugin
      await storage.upload(buffer, {
        filename: "test.jpg",
        mimeType: "image/jpeg",
        collection: "other",
      });

      // S3 adapter should not be called
      expect(plugin.adapter.upload).not.toHaveBeenCalled();
    });

    it("should apply collection prefix if configured", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", {
        documents: { prefix: "docs/" },
      });
      const storage = new MediaStorage({ plugins: [plugin] });
      const buffer = Buffer.from("test");

      await storage.upload(buffer, {
        filename: "test.pdf",
        mimeType: "application/pdf",
        collection: "documents",
      });

      expect(plugin.adapter.upload).toHaveBeenCalledWith(
        buffer,
        expect.objectContaining({
          folder: "docs/",
        })
      );
    });

    it("should return correct storage type per collection", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      expect(storage.getStorageType("media")).toBe("s3");
      expect(storage.getStorageType("other")).toBe("local");
      expect(storage.getStorageType()).toBe("local"); // No collection = default
    });

    it("should delete from correct adapter", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      await storage.delete("file.jpg", "media");

      expect(plugin.adapter.delete).toHaveBeenCalledWith("file.jpg");
    });

    it("should check exists on correct adapter", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      await storage.exists("file.jpg", "media");

      expect(plugin.adapter.exists).toHaveBeenCalledWith("file.jpg");
    });

    it("should get public URL from correct adapter", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      const url = storage.getPublicUrl("file.jpg", "media");

      expect(plugin.adapter.getPublicUrl).toHaveBeenCalledWith("file.jpg");
      expect(url).toBe("https://s3.test/file.jpg");
    });
  });

  describe("Client Upload Support", () => {
    it("should return false if clientUploads not enabled", () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: true },
        { supportsClientUploads: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      // Collection config doesn't have clientUploads: true
      expect(storage.supportsClientUploads("media")).toBe(false);
    });

    it("should return true if clientUploads enabled and supported", () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: { clientUploads: true } },
        { supportsClientUploads: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      expect(storage.supportsClientUploads("media")).toBe(true);
    });

    it("should return false if adapter doesn't support client uploads", () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: { clientUploads: true } },
        { supportsClientUploads: false }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      expect(storage.supportsClientUploads("media")).toBe(false);
    });

    it("should generate client upload URL when supported", async () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: { clientUploads: true } },
        { supportsClientUploads: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      const data = await storage.getClientUploadUrl(
        "photo.jpg",
        "image/jpeg",
        "media"
      );

      expect(data).not.toBeNull();
      expect(data?.uploadUrl).toBe("https://s3.test/presigned");
      expect(plugin.getClientUploadUrl).toHaveBeenCalledWith(
        "photo.jpg",
        "image/jpeg",
        "media"
      );
    });

    it("should return null when client uploads not supported", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      const data = await storage.getClientUploadUrl(
        "photo.jpg",
        "image/jpeg",
        "media"
      );

      expect(data).toBeNull();
    });
  });

  describe("Signed Download Support", () => {
    it("should return false if signedDownloads not enabled", () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: true },
        { supportsSignedUrls: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      expect(storage.supportsSignedDownloads("media")).toBe(false);
    });

    it("should return true if signedDownloads enabled and supported", () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: { signedDownloads: true } },
        { supportsSignedUrls: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      expect(storage.supportsSignedDownloads("media")).toBe(true);
    });

    it("should generate signed download URL when supported", async () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: { signedDownloads: true } },
        { supportsSignedUrls: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      const url = await storage.getSignedDownloadUrl("file.jpg", "media", 3600);

      expect(url).toBe("https://s3.test/signed/file.jpg");
      expect(plugin.getSignedDownloadUrl).toHaveBeenCalledWith(
        "file.jpg",
        3600
      );
    });

    it("should use default expiry from collection config", async () => {
      const plugin = createMockPlugin(
        "s3-plugin",
        "s3",
        { media: { signedDownloads: true, signedUrlExpiresIn: 900 } },
        { supportsSignedUrls: true }
      );
      const storage = new MediaStorage({ plugins: [plugin] });

      await storage.getSignedDownloadUrl("file.jpg", "media");

      expect(plugin.getSignedDownloadUrl).toHaveBeenCalledWith("file.jpg", 900);
    });

    it("should return null when signed downloads not supported", async () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      const url = await storage.getSignedDownloadUrl("file.jpg", "media");

      expect(url).toBeNull();
    });
  });

  describe("Singleton Pattern", () => {
    it("should return same instance on multiple calls", () => {
      const instance1 = getMediaStorage();
      const instance2 = getMediaStorage();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance after reset", () => {
      const instance1 = getMediaStorage();
      resetMediaStorage();
      const instance2 = getMediaStorage();

      expect(instance1).not.toBe(instance2);
    });

    it("should initialize with plugins", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });

      const storage = initializeMediaStorage({ plugins: [plugin] });

      expect(storage.getPlugins()).toHaveLength(1);

      // getMediaStorage should return the same instance
      expect(getMediaStorage()).toBe(storage);
    });
  });

  describe("Accessor Methods", () => {
    it("should return default adapter", () => {
      const storage = new MediaStorage();

      const adapter = storage.getDefaultAdapter();

      expect(adapter.getType()).toBe("local");
    });

    it("should return adapter for collection", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      const adapter = storage.getAdapter("media");

      expect(adapter.getType()).toBe("s3");
    });

    it("should return default adapter when no collection specified", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", { media: true });
      const storage = new MediaStorage({ plugins: [plugin] });

      const adapter = storage.getAdapter();

      expect(adapter.getType()).toBe("local");
    });

    it("should return configured collections", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", {
        media: true,
        documents: { prefix: "docs/" },
      });
      const storage = new MediaStorage({ plugins: [plugin] });

      const collections = storage.getConfiguredCollections();

      expect(collections).toContain("media");
      expect(collections).toContain("documents");
      expect(collections).toHaveLength(2);
    });

    it("should return collection config", () => {
      const plugin = createMockPlugin("s3-plugin", "s3", {
        media: { prefix: "media/", clientUploads: true },
      });
      const storage = new MediaStorage({ plugins: [plugin] });

      const config = storage.getCollectionConfig("media");

      expect(config).toEqual({ prefix: "media/", clientUploads: true });
    });

    it("should return undefined for unconfigured collection", () => {
      const storage = new MediaStorage();

      const config = storage.getCollectionConfig("other");

      expect(config).toBeUndefined();
    });
  });
});

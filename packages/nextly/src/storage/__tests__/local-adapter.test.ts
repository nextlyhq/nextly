/**
 * Local Disk Storage Adapter Tests
 *
 * Tests for the local filesystem storage adapter used as default
 * storage for development environments.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { consoleLogger } from "../../shared/types";
import { isGeneratedStorageKey } from "../adapters/base-adapter";
import {
  LocalStorageAdapter,
  markLocalUploadsRouteLoaded,
  resetLocalAdapterState,
} from "../adapters/local-adapter";

describe("LocalStorageAdapter", () => {
  let adapter: LocalStorageAdapter;
  let testDir: string;

  beforeEach(async () => {
    // Create a temp directory for each test to avoid conflicts
    testDir = path.join(os.tmpdir(), `nextly-local-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    adapter = new LocalStorageAdapter({
      basePath: testDir,
      baseUrl: "/uploads",
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // A file can be removed while the folder is being listed, by a delete
  // running at the same time. It is gone, which is no reason to stop
  // listing the rest.
  describe("list()", () => {
    it("skips a file removed while the folder is being listed", async () => {
      for (const name of ["a.png", "b.png", "c.png"]) {
        await fs.writeFile(path.join(testDir, name), "x");
      }
      const listed: string[] = [];
      let removed = false;

      for await (const entry of adapter.list()) {
        listed.push(entry.path);
        if (!removed) {
          removed = true;
          const others = ["a.png", "b.png", "c.png"].filter(
            name => name !== entry.path
          );
          await fs.rm(path.join(testDir, others[0]));
        }
      }

      expect(listed).toHaveLength(2);
    });
  });

  /*
   * `next start` serves only the files `public/` held when it started, so a
   * production upload with no route serving the folder is a 404 until the
   * next restart. The upload is where that can be said.
   */
  describe("an upload in production", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      resetLocalAdapterState();
      warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      warn.mockRestore();
      resetLocalAdapterState();
    });

    const store = () =>
      adapter.upload(Buffer.from("x"), {
        filename: "a.png",
        mimeType: "image/png",
      });

    it("warns once, naming the URL and the route to add, when no uploads route has loaded", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const first = await store();
      await store();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain(first.url);
      expect(message).toContain("app/uploads/[...path]/route.ts");
    });

    it("does not warn once the uploads route has loaded", async () => {
      vi.stubEnv("NODE_ENV", "production");
      markLocalUploadsRouteLoaded();

      await store();

      expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn outside production, where Next.js reads the folder on every request", async () => {
      vi.stubEnv("NODE_ENV", "development");

      await store();

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("getType()", () => {
    it("should return 'local'", () => {
      expect(adapter.getType()).toBe("local");
    });
  });

  // The cache policy trusts `isGeneratedStorageKey` to recognize what the
  // writer produced; a key the writer stores that the recognizer rejects (or
  // the reverse) is how the two layouts would drift apart.
  describe("a generated key", () => {
    it("is recognized for every key upload writes, with or without a folder", async () => {
      for (const options of [
        { filename: "photo.jpg", mimeType: "image/jpeg" },
        { filename: "Résumé (final).PDF", mimeType: "application/pdf" },
        { filename: "a.b.c.png", mimeType: "image/png", folder: "documents" },
        { filename: "x.webp", mimeType: "image/webp", folder: "a/b" },
      ]) {
        const { path: key } = await adapter.upload(Buffer.from("x"), options);
        expect(isGeneratedStorageKey(key), key).toBe(true);
      }
    });

    it("is not recognized for a name placed in the folder by hand", () => {
      expect(isGeneratedStorageKey("logo.png")).toBe(false);
      expect(isGeneratedStorageKey("2026/10/logo.png")).toBe(false);
    });
  });

  describe("upload()", () => {
    it("should write file to disk and return url/path", async () => {
      const buffer = Buffer.from("test file content");
      const result = await adapter.upload(buffer, {
        filename: "photo.jpg",
        mimeType: "image/jpeg",
      });

      // Should return a URL starting with baseUrl
      expect(result.url).toMatch(/^\/uploads\//);
      // Should return a path relative to basePath
      expect(result.path).toBeTruthy();

      // File should exist on disk
      const fullPath = path.join(testDir, result.path);
      const content = await fs.readFile(fullPath);
      expect(content.toString()).toBe("test file content");
    });

    it("should create directories recursively", async () => {
      const buffer = Buffer.from("test");
      const result = await adapter.upload(buffer, {
        filename: "doc.pdf",
        mimeType: "application/pdf",
      });

      // Path should contain year/month subdirectories
      expect(result.path).toMatch(/\d{4}\/\d{2}\//);

      // File should exist
      const fullPath = path.join(testDir, result.path);
      const stat = await fs.stat(fullPath);
      expect(stat.isFile()).toBe(true);
    });

    it("should sanitize filenames", async () => {
      const buffer = Buffer.from("test");
      const result = await adapter.upload(buffer, {
        filename: "my file (1).jpg",
        mimeType: "image/jpeg",
      });

      // Filename in path should be sanitized (no spaces or parens)
      expect(result.path).not.toContain(" ");
      expect(result.path).not.toContain("(");
    });

    it("should use folder prefix when provided", async () => {
      const buffer = Buffer.from("test");
      const result = await adapter.upload(buffer, {
        filename: "doc.pdf",
        mimeType: "application/pdf",
        folder: "private",
      });

      // Path should start with the folder prefix
      expect(result.path).toMatch(/^private\//);
    });
  });

  describe("delete()", () => {
    it("should remove file from disk", async () => {
      // First upload a file
      const buffer = Buffer.from("test");
      const result = await adapter.upload(buffer, {
        filename: "to-delete.jpg",
        mimeType: "image/jpeg",
      });

      // Verify it exists
      const fullPath = path.join(testDir, result.path);
      expect(await fileExists(fullPath)).toBe(true);

      // Delete it
      await adapter.delete(result.path);

      // Verify it's gone
      expect(await fileExists(fullPath)).toBe(false);
    });

    it("should not throw when file does not exist", async () => {
      // Deleting a non-existent file should not throw
      await expect(
        adapter.delete("nonexistent/file.jpg")
      ).resolves.toBeUndefined();
    });
  });

  describe("exists()", () => {
    it("should return true for existing file", async () => {
      const buffer = Buffer.from("test");
      const result = await adapter.upload(buffer, {
        filename: "check.jpg",
        mimeType: "image/jpeg",
      });

      expect(await adapter.exists(result.path)).toBe(true);
    });

    it("should return false for non-existing file", async () => {
      expect(await adapter.exists("does-not-exist.jpg")).toBe(false);
    });
  });

  describe("getPublicUrl()", () => {
    it("should return baseUrl + relative path", () => {
      const url = adapter.getPublicUrl("2026/04/uuid-photo.jpg");
      expect(url).toBe("/uploads/2026/04/uuid-photo.jpg");
    });

    it("should handle paths with leading slash", () => {
      const url = adapter.getPublicUrl("/2026/04/uuid-photo.jpg");
      expect(url).toBe("/uploads/2026/04/uuid-photo.jpg");
    });

    // A project that serves uploads from another origin sets the base to an
    // absolute URL, and the media URLs are on it.
    it.each([
      [
        "https://media.example.com",
        "https://media.example.com/2026/04/uuid-photo.jpg",
      ],
      [
        "https://media.example.com/",
        "https://media.example.com/2026/04/uuid-photo.jpg",
      ],
      [
        "https://cdn.example.com/site/uploads",
        "https://cdn.example.com/site/uploads/2026/04/uuid-photo.jpg",
      ],
    ])("puts the file on an absolute baseUrl %s", async (baseUrl, expected) => {
      const onAbsolute = new LocalStorageAdapter({
        basePath: testDir,
        baseUrl,
      });
      expect(onAbsolute.getPublicUrl("2026/04/uuid-photo.jpg")).toBe(expected);
      const stored = await onAbsolute.upload(Buffer.from("x"), {
        filename: "photo.jpg",
        mimeType: "image/jpeg",
      });
      expect(stored.url).toBe(`${baseUrl.replace(/\/$/, "")}/${stored.path}`);
    });

    it("should round-trip: upload URL points to file on disk", async () => {
      const buffer = Buffer.from("test content");
      const result = await adapter.upload(buffer, {
        filename: "roundtrip.jpg",
        mimeType: "image/jpeg",
      });

      // URL should be baseUrl + path (no "uploads/" duplication)
      expect(result.url).toBe(`/uploads/${result.path}`);

      // File should exist at exactly that location on disk
      const fullPath = path.join(testDir, result.path);
      expect(await fileExists(fullPath)).toBe(true);
    });
  });

  describe("bulkDelete()", () => {
    it("should delete multiple files", async () => {
      // Upload two files
      const buffer = Buffer.from("test");
      const result1 = await adapter.upload(buffer, {
        filename: "file1.jpg",
        mimeType: "image/jpeg",
      });
      const result2 = await adapter.upload(buffer, {
        filename: "file2.jpg",
        mimeType: "image/jpeg",
      });

      const result = await adapter.bulkDelete([result1.path, result2.path]);

      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it("should handle mix of existing and non-existing files", async () => {
      const buffer = Buffer.from("test");
      const uploaded = await adapter.upload(buffer, {
        filename: "exists.jpg",
        mimeType: "image/jpeg",
      });

      const result = await adapter.bulkDelete([
        uploaded.path,
        "nonexistent.jpg",
      ]);

      // Both should succeed (delete of non-existent is not an error)
      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe("security", () => {
    it("should reject path traversal in filenames", async () => {
      const buffer = Buffer.from("malicious");
      const result = await adapter.upload(buffer, {
        filename: "../../../etc/passwd",
        mimeType: "text/plain",
      });

      // The sanitized path should not contain traversal sequences
      expect(result.path).not.toContain("..");

      // File should be stored within basePath
      const fullPath = path.join(testDir, result.path);
      expect(fullPath.startsWith(testDir)).toBe(true);
    });

    it("should reject delete paths outside basePath", async () => {
      // Attempting to delete outside basePath should be rejected
      await expect(
        adapter.delete("../../../etc/passwd")
      ).resolves.toBeUndefined();

      // The file outside basePath should NOT have been deleted
      // (we can't verify this without creating a real file, but the adapter
      // should resolve the path and check it's within basePath)
    });

    /*
     * A folder BESIDE the storage folder whose name starts with the storage
     * folder's name: `uploads-private` next to `uploads`. A containment check
     * comparing string prefixes counts it as inside. `....//` is what reaches
     * it, because stripping `../` once leaves `../` behind.
     */
    describe("a sibling folder sharing the storage folder's name as a prefix", () => {
      let root: string;
      let sibling: string;
      let prefixed: LocalStorageAdapter;
      const escape = "....//uploads-private/secret.txt";

      beforeEach(async () => {
        root = path.join(testDir, "site");
        sibling = path.join(root, "uploads-private", "secret.txt");
        await fs.mkdir(path.join(root, "uploads"), { recursive: true });
        await fs.mkdir(path.dirname(sibling), { recursive: true });
        await fs.writeFile(sibling, "not for the public");
        prefixed = new LocalStorageAdapter({
          basePath: path.join(root, "uploads"),
          baseUrl: "/uploads",
        });
      });

      it("is not read", async () => {
        await expect(prefixed.read(escape)).resolves.toBeNull();
      });

      it("is not deleted from", async () => {
        await prefixed.delete(escape);
        expect(await fileExists(sibling)).toBe(true);
      });

      it("is not reported as stored", async () => {
        await expect(prefixed.exists(escape)).resolves.toBe(false);
      });
    });
  });
});

/**
 * Helper to check if a file exists
 */
async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

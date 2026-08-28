/**
 * Media Folder Tests
 *
 * Tests for folder CRUD operations via the unified MediaService.
 *
 * Covers:
 * - Create folder (root and nested)
 * - Rename folder
 * - Delete folder (empty and with children check)
 * - List folder contents (subfolders + files)
 * - Delete folder with contents flag
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { NextlyError } from "../../../errors";
import { UploadValidator } from "../../../services/upload-validation";
import { MediaService } from "../services/media-service";
import type {
  MediaFolder,
  CreateFolderInput,
  FolderContents,
} from "../services/media-service";

// ── Mock Types ──────────────────────────────────────────────────────────

interface MockLegacyResult<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T | null;
}

// ── Mock Factories ──────────────────────────────────────────────────────

function createMockFolder(overrides: Partial<MediaFolder> = {}): MediaFolder {
  return {
    id: "folder-001",
    name: "Test Folder",
    description: null,
    color: null,
    icon: null,
    parentId: null,
    createdBy: "user-001",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function successResult<T>(data: T): MockLegacyResult<T> {
  return { success: true, statusCode: 200, message: "OK", data };
}

function errorResult(
  statusCode: number,
  message: string
): MockLegacyResult<null> {
  return { success: false, statusCode, message, data: null };
}

// ── Context ─────────────────────────────────────────────────────────────

const context = {
  user: { id: "user-001", email: "test@example.com" },
  locale: "en",
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("MediaService — Folder Operations", () => {
  let service: MediaService;
  let mockLegacyMedia: Record<string, ReturnType<typeof vi.fn>>;
  let mockLegacyFolder: Record<string, ReturnType<typeof vi.fn>>;
  let mockStorage: Record<string, ReturnType<typeof vi.fn>>;
  let mockImageProcessor: Record<string, ReturnType<typeof vi.fn>>;
  const silentLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    mockLegacyMedia = {
      uploadMedia: vi.fn(),
      getMediaById: vi.fn(),
      listMedia: vi.fn(),
      updateMedia: vi.fn(),
      deleteMedia: vi.fn(),
    };

    mockLegacyFolder = {
      createFolder: vi.fn(),
      getFolderById: vi.fn(),
      listRootFolders: vi.fn(),
      listSubfolders: vi.fn(),
      getFolderContents: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
      moveMediaToFolder: vi.fn(),
    };

    mockStorage = {
      getType: vi.fn().mockReturnValue("local"),
    };

    mockImageProcessor = {
      isValidImage: vi.fn().mockResolvedValue(true),
      getDimensions: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    };

    service = new MediaService(
      mockLegacyMedia as never,
      mockLegacyFolder as never,
      mockStorage as never,
      mockImageProcessor as never,
      new UploadValidator(undefined),
      true,
      silentLogger
    );
  });

  // ── Create Folder ───────────────────────────────────────────────────

  describe("createFolder", () => {
    it("should create a root folder", async () => {
      const folderData = createMockFolder();
      mockLegacyFolder.createFolder.mockResolvedValue(
        successResult(folderData)
      );

      const input: CreateFolderInput = { name: "Photos" };
      const result = await service.createFolder(input, context);

      expect(result.id).toBe("folder-001");
      expect(result.name).toBe("Test Folder");
      expect(mockLegacyFolder.createFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Photos",
          createdBy: "user-001",
        })
      );
    });

    it("should create a nested subfolder", async () => {
      const subfolder = createMockFolder({
        id: "folder-002",
        name: "Vacation",
        parentId: "folder-001",
      });
      mockLegacyFolder.createFolder.mockResolvedValue(successResult(subfolder));

      const input: CreateFolderInput = {
        name: "Vacation",
        parentId: "folder-001",
      };
      const result = await service.createFolder(input, context);

      expect(result.parentId).toBe("folder-001");
      expect(result.name).toBe("Vacation");
    });

    it("should throw NOT_FOUND if parent folder does not exist", async () => {
      mockLegacyFolder.createFolder.mockResolvedValue(
        errorResult(404, "Parent folder not found")
      );

      await expect(
        service.createFolder(
          { name: "Orphan", parentId: "nonexistent" },
          context
        )
      ).rejects.toThrow(NextlyError);
    });

    it("should throw DUPLICATE if folder name already exists", async () => {
      // The folder service names its own code: 409 covers a name clash and a
      // stale write, and only the producer can tell them apart. A boundary
      // inferring from the status alone has to read it as staleness, which
      // would tell someone whose name is taken to reload the page.
      mockLegacyFolder.createFolder.mockResolvedValue({
        ...errorResult(409, "A folder with this name already exists"),
        code: "DUPLICATE",
      });

      const thrown = await service
        .createFolder({ name: "Duplicate", parentId: "p-1" }, context)
        .catch((e: unknown) => e as NextlyError);

      expect(thrown).toBeInstanceOf(NextlyError);
      expect(thrown.code).toBe("DUPLICATE");
      expect(thrown.publicMessage).not.toContain("refresh");
      // The diagnostics used to ride on a status branch that a named code now
      // skips, so an identified collision became an unidentifiable one in the
      // operator log. Asserting only `toThrow(NextlyError)` is what hid it.
      expect(thrown.logContext).toMatchObject({
        entity: "folder",
        name: "Duplicate",
        parentId: "p-1",
      });
      // Operator-side only: the name must not reach the caller (spec 13.8).
      expect(thrown.publicMessage).not.toContain("Duplicate");
    });

    it("keeps a typed lookup failure instead of reporting absence", async () => {
      // findFolderById answered every failure as NOT_FOUND, so a database that
      // was unreachable told the caller the folder does not exist. Nothing
      // useful follows from that: the caller stops looking rather than retrying.
      mockLegacyFolder.getFolderById.mockResolvedValue({
        success: false,
        statusCode: 503,
        code: "SERVICE_UNAVAILABLE",
        message: "database unreachable",
        data: null,
      });

      const thrown = await service
        .findFolderById("f-1", context)
        .catch((e: unknown) => e as NextlyError);

      expect(thrown.code).toBe("SERVICE_UNAVAILABLE");
      expect(thrown.logContext).toMatchObject({
        entity: "folder",
        folderId: "f-1",
      });
    });

    it("still reports a code-less lookup failure as not found", async () => {
      // The common case has to keep working: a missing row reports 404 with no
      // code, and that must still read as absence.
      mockLegacyFolder.getFolderById.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "not found",
        data: null,
      });

      const thrown = await service
        .findFolderById("f-2", context)
        .catch((e: unknown) => e as NextlyError);

      expect(thrown.code).toBe("NOT_FOUND");
      expect(thrown.publicMessage).toBe("Not found.");
      expect(thrown.publicMessage).not.toContain("f-2");
    });

    it("keeps the caller's context when the failure names no code", async () => {
      // The other half of the same guarantee: whichever reading applies, the
      // log identifies which folder operation failed.
      mockLegacyFolder.createFolder.mockResolvedValue(
        errorResult(500, "connection terminated")
      );

      const thrown = await service
        .createFolder({ name: "Anything", parentId: "p-2" }, context)
        .catch((e: unknown) => e as NextlyError);

      expect(thrown.code).toBe("INTERNAL_ERROR");
      expect(thrown.logContext).toMatchObject({
        entity: "folder",
        name: "Anything",
        parentId: "p-2",
      });
    });
  });

  // ── Rename Folder (Update) ────────────────────────────────────────

  describe("updateFolder (rename)", () => {
    it("should rename a folder", async () => {
      const updated = createMockFolder({ name: "Renamed Folder" });
      mockLegacyFolder.updateFolder.mockResolvedValue(successResult(updated));

      const result = await service.updateFolder(
        "folder-001",
        { name: "Renamed Folder" },
        context
      );

      expect(result.name).toBe("Renamed Folder");
      expect(mockLegacyFolder.updateFolder).toHaveBeenCalledWith(
        "folder-001",
        expect.objectContaining({ name: "Renamed Folder" })
      );
    });

    it("should throw NOT_FOUND for non-existent folder", async () => {
      mockLegacyFolder.updateFolder.mockResolvedValue(
        errorResult(404, "Folder not found")
      );

      await expect(
        service.updateFolder("nonexistent", { name: "New Name" }, context)
      ).rejects.toThrow(NextlyError);
    });
  });

  // ── Delete Folder ─────────────────────────────────────────────────

  describe("deleteFolder", () => {
    it("should delete an empty folder", async () => {
      mockLegacyFolder.deleteFolder.mockResolvedValue(successResult(null));

      await expect(
        service.deleteFolder("folder-001", false, context)
      ).resolves.toBeUndefined();

      expect(mockLegacyFolder.deleteFolder).toHaveBeenCalledWith(
        "folder-001",
        false
      );
    });

    it("should throw VALIDATION when folder has children and deleteContents is false", async () => {
      mockLegacyFolder.deleteFolder.mockResolvedValue(
        errorResult(400, "Folder is not empty")
      );

      await expect(
        service.deleteFolder("folder-001", false, context)
      ).rejects.toThrow(NextlyError);
    });

    it("should delete folder with contents when deleteContents is true", async () => {
      mockLegacyFolder.deleteFolder.mockResolvedValue(successResult(null));

      await expect(
        service.deleteFolder("folder-001", true, context)
      ).resolves.toBeUndefined();

      expect(mockLegacyFolder.deleteFolder).toHaveBeenCalledWith(
        "folder-001",
        true
      );
    });

    it("should throw NOT_FOUND for non-existent folder", async () => {
      mockLegacyFolder.deleteFolder.mockResolvedValue(
        errorResult(404, "Folder not found")
      );

      await expect(
        service.deleteFolder("nonexistent", false, context)
      ).rejects.toThrow(NextlyError);
    });
  });

  // ── List Folder Contents ──────────────────────────────────────────

  describe("getFolderContents", () => {
    it("should return subfolders and files for a given folder", async () => {
      const folder = createMockFolder();
      const subfolder = createMockFolder({
        id: "folder-002",
        name: "Subfolder",
        parentId: "folder-001",
      });
      const mediaFile = {
        id: "media-001",
        filename: "photo.jpg",
        originalFilename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        width: 800,
        height: 600,
        duration: null,
        url: "https://test.com/photo.jpg",
        thumbnailUrl: null,
        altText: null,
        caption: null,
        tags: null,
        folderId: "folder-001",
        uploadedBy: "user-001",
        uploadedAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      };

      mockLegacyFolder.getFolderContents.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          folder,
          subfolders: [subfolder],
          mediaFiles: [mediaFile],
          breadcrumbs: [{ id: "folder-001", name: "Test Folder" }],
        },
      });

      const result: FolderContents = await service.getFolderContents(
        "folder-001",
        context
      );

      expect(result.folder.id).toBe("folder-001");
      expect(result.subfolders).toHaveLength(1);
      expect(result.subfolders[0].name).toBe("Subfolder");
      expect(result.files).toHaveLength(1);
      expect(result.files[0].filename).toBe("photo.jpg");
      expect(result.breadcrumbs).toEqual([
        { id: "folder-001", name: "Test Folder" },
      ]);
    });

    it("should throw NOT_FOUND for non-existent folder", async () => {
      mockLegacyFolder.getFolderContents.mockResolvedValue(
        errorResult(404, "Folder not found")
      );

      await expect(
        service.getFolderContents("nonexistent", context)
      ).rejects.toThrow(NextlyError);
    });
  });

  // ── Find Folder By ID ─────────────────────────────────────────────

  describe("findFolderById", () => {
    it("should return folder by ID", async () => {
      const folder = createMockFolder();
      mockLegacyFolder.getFolderById.mockResolvedValue(successResult(folder));

      const result = await service.findFolderById("folder-001", context);

      expect(result.id).toBe("folder-001");
      expect(result.name).toBe("Test Folder");
    });

    it("should throw NOT_FOUND for non-existent folder", async () => {
      mockLegacyFolder.getFolderById.mockResolvedValue(
        errorResult(404, "Folder not found")
      );

      await expect(
        service.findFolderById("nonexistent", context)
      ).rejects.toThrow(NextlyError);
    });
  });

  // ── List Root Folders ─────────────────────────────────────────────

  describe("listRootFolders", () => {
    it("should return only root-level folders", async () => {
      const root1 = createMockFolder({ id: "folder-001", name: "Photos" });
      const root2 = createMockFolder({ id: "folder-002", name: "Documents" });
      mockLegacyFolder.listRootFolders.mockResolvedValue(
        successResult([root1, root2])
      );

      const result = await service.listRootFolders(context);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Photos");
      expect(result[1].name).toBe("Documents");
    });
  });

  // ── List Subfolders ───────────────────────────────────────────────

  describe("listSubfolders", () => {
    it("should return subfolders of a parent", async () => {
      const sub = createMockFolder({
        id: "folder-002",
        name: "Sub",
        parentId: "folder-001",
      });
      mockLegacyFolder.listSubfolders.mockResolvedValue(successResult([sub]));

      const result = await service.listSubfolders("folder-001", context);

      expect(result).toHaveLength(1);
      expect(result[0].parentId).toBe("folder-001");
    });
  });

  // ── Move Media to Folder ──────────────────────────────────────────

  describe("moveToFolder", () => {
    // A move is no longer a bare folder write. It is routed through
    // `updateMedia` so the folder change is recorded as a `media.updated`
    // outbox event -- the previous path wrote the column and recorded nothing,
    // so subscribers never learned a file had moved. These tests assert the
    // update path, because asserting `moveMediaToFolder` would pass against an
    // implementation that emits no event, which is the defect that was fixed.
    it("should move media to a folder", async () => {
      mockLegacyFolder.getFolderById.mockResolvedValue(
        successResult(createMockFolder())
      );
      mockLegacyMedia.updateMedia.mockResolvedValue(successResult(null));

      await expect(
        service.moveToFolder("media-001", "folder-001", context)
      ).resolves.toBeUndefined();

      // The actor is asserted, not waved through: it is what attributes the
      // outbox event, and `actorForWrite` falls back to the request user when
      // no transport actor is threaded.
      expect(mockLegacyMedia.updateMedia).toHaveBeenCalledWith(
        "media-001",
        { folderId: "folder-001" },
        { type: "user", id: "user-001" }
      );
    });

    it("should move media to root (null folder)", async () => {
      mockLegacyMedia.updateMedia.mockResolvedValue(successResult(null));

      await expect(
        service.moveToFolder("media-001", null, context)
      ).resolves.toBeUndefined();

      expect(mockLegacyMedia.updateMedia).toHaveBeenCalledWith(
        "media-001",
        { folderId: null },
        { type: "user", id: "user-001" }
      );
      // Root is not a folder, so there is nothing to validate. Asserted because
      // a lookup here would 404 every move to root.
      expect(mockLegacyFolder.getFolderById).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when the target folder does not exist, before writing", async () => {
      mockLegacyFolder.getFolderById.mockResolvedValue(
        errorResult(404, "Not found")
      );
      mockLegacyMedia.updateMedia.mockResolvedValue(successResult(null));

      await expect(
        service.moveToFolder("media-001", "missing-folder", context)
      ).rejects.toThrow(NextlyError);

      // "Before the write" is the documented point of validating up front, and
      // it is the half a rejects-toThrow assertion cannot see: without this the
      // test passes just as well against a service that writes and then throws.
      expect(mockLegacyMedia.updateMedia).not.toHaveBeenCalled();
    });

    it("should throw NOT_FOUND when the media does not exist", async () => {
      mockLegacyFolder.getFolderById.mockResolvedValue(
        successResult(createMockFolder())
      );
      mockLegacyMedia.updateMedia.mockResolvedValue(
        errorResult(404, "Not found")
      );

      await expect(
        service.moveToFolder("nonexistent", "folder-001", context)
      ).rejects.toThrow(NextlyError);
    });
  });
});

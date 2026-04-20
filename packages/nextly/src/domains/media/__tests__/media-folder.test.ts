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

import { ServiceError } from "../../../errors";
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
      ).rejects.toThrow(ServiceError);
    });

    it("should throw DUPLICATE if folder name already exists", async () => {
      mockLegacyFolder.createFolder.mockResolvedValue(
        errorResult(409, "Folder name already exists")
      );

      await expect(
        service.createFolder({ name: "Duplicate" }, context)
      ).rejects.toThrow(ServiceError);
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
      ).rejects.toThrow(ServiceError);
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
      ).rejects.toThrow(ServiceError);
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
      ).rejects.toThrow(ServiceError);
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
      ).rejects.toThrow(ServiceError);
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
      ).rejects.toThrow(ServiceError);
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
    it("should move media to a folder", async () => {
      mockLegacyFolder.moveMediaToFolder.mockResolvedValue(successResult(null));

      await expect(
        service.moveToFolder("media-001", "folder-001", context)
      ).resolves.toBeUndefined();

      expect(mockLegacyFolder.moveMediaToFolder).toHaveBeenCalledWith(
        "media-001",
        "folder-001"
      );
    });

    it("should move media to root (null folder)", async () => {
      mockLegacyFolder.moveMediaToFolder.mockResolvedValue(successResult(null));

      await expect(
        service.moveToFolder("media-001", null, context)
      ).resolves.toBeUndefined();

      expect(mockLegacyFolder.moveMediaToFolder).toHaveBeenCalledWith(
        "media-001",
        null
      );
    });

    it("should throw NOT_FOUND if media or folder does not exist", async () => {
      mockLegacyFolder.moveMediaToFolder.mockResolvedValue(
        errorResult(404, "Not found")
      );

      await expect(
        service.moveToFolder("nonexistent", "folder-001", context)
      ).rejects.toThrow(ServiceError);
    });
  });
});

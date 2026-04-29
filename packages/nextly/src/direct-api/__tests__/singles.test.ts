/**
 * Direct API - Singles/Globals Operations Tests
 *
 * Tests: findGlobal, updateGlobal, findGlobals
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";

import {
  NextlyError,
  NotFoundError,
  ValidationError,
  DatabaseError,
} from "../errors";
import type { Nextly } from "../nextly";

import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

describe("Direct API - Singles Operations", () => {
  let nextly: Nextly;
  let mocks: TestMocks;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupTestNextly();
    nextly = setup.nextly;
    mocks = setup.mocks;
    cleanup = setup.cleanup;
  });

  afterAll(() => {
    cleanup?.();
  });

  describe("findGlobal()", () => {
    it("should return single document on success", async () => {
      const mockData = { id: "1", siteName: "My Site", maintenanceMode: false };
      mocks.singleEntryService.get.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: mockData,
      });

      const result = await nextly.findGlobal({ slug: "site-settings" });

      expect(result).toEqual(mockData);
      expect(mocks.singleEntryService.get).toHaveBeenCalledWith(
        "site-settings",
        expect.objectContaining({
          overrideAccess: true,
        })
      );
    });

    it("should pass depth and locale options", async () => {
      mocks.singleEntryService.get.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: { id: "1" },
      });

      await nextly.findGlobal({
        slug: "site-settings",
        depth: 2,
        locale: "en",
      });

      expect(mocks.singleEntryService.get).toHaveBeenCalledWith(
        "site-settings",
        expect.objectContaining({
          depth: 2,
          locale: "en",
        })
      );
    });

    it("should throw NotFoundError on failure with 404", async () => {
      mocks.singleEntryService.get.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Single not found",
      });

      await expect(nextly.findGlobal({ slug: "nonexistent" })).rejects.toThrow(
        NotFoundError
      );
    });

    it("should throw NextlyError on other failures", async () => {
      mocks.singleEntryService.get.mockResolvedValue({
        success: false,
        statusCode: 500,
        message: "Internal error",
      });

      await expect(
        nextly.findGlobal({ slug: "site-settings" })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("updateGlobal()", () => {
    it("should return updated document on success", async () => {
      const mockData = {
        id: "1",
        siteName: "Updated Site",
        updatedAt: new Date().toISOString(),
      };
      mocks.singleEntryService.update.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: mockData,
      });

      const result = await nextly.updateGlobal({
        slug: "site-settings",
        data: { siteName: "Updated Site" },
      });

      expect(result).toEqual(mockData);
      expect(mocks.singleEntryService.update).toHaveBeenCalledWith(
        "site-settings",
        { siteName: "Updated Site" },
        expect.objectContaining({
          overrideAccess: true,
        })
      );
    });

    it("should pass user context and locale", async () => {
      mocks.singleEntryService.update.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: { id: "1" },
      });

      await nextly.updateGlobal({
        slug: "site-settings",
        data: { siteName: "Test" },
        overrideAccess: false,
        user: { id: "user-1", role: "admin" },
        locale: "fr",
      });

      expect(mocks.singleEntryService.update).toHaveBeenCalledWith(
        "site-settings",
        { siteName: "Test" },
        expect.objectContaining({
          overrideAccess: false,
          locale: "fr",
        })
      );
    });

    it("should throw ValidationError on validation failure", async () => {
      mocks.singleEntryService.update.mockResolvedValue({
        success: false,
        statusCode: 400,
        message: "Validation failed",
        errors: [{ field: "siteName", message: "Required" }],
      });

      await expect(
        nextly.updateGlobal({
          slug: "site-settings",
          data: {},
        })
      ).rejects.toThrow(ValidationError);
    });

    it("should throw NotFoundError when single not found", async () => {
      mocks.singleEntryService.update.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Single not found",
      });

      await expect(
        nextly.updateGlobal({
          slug: "nonexistent",
          data: { key: "value" },
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("findGlobals()", () => {
    const makeRegistryRecord = (slug: string) => ({
      id: `id-${slug}`,
      slug,
      label: slug,
      tableName: `single_${slug}`,
      fields: [],
      source: "code",
      locked: true,
      configPath: null,
      schemaHash: "abc123",
      schemaVersion: 1,
      migrationStatus: "synced",
      lastMigrationId: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-02"),
    });

    it("should return actual content for all singles", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [
          makeRegistryRecord("site-settings"),
          makeRegistryRecord("header"),
        ],
        total: 2,
      });
      mocks.singleEntryService.get
        .mockResolvedValueOnce({
          success: true,
          statusCode: 200,
          data: { id: "1", siteName: "My Site" },
        })
        .mockResolvedValueOnce({
          success: true,
          statusCode: 200,
          data: { id: "2", logo: "logo.png" },
        });

      const result = await nextly.findGlobals();

      expect(result.docs).toHaveLength(2);
      expect(result.totalDocs).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.docs[0]).toEqual({
        slug: "site-settings",
        label: "site-settings",
        data: { id: "1", siteName: "My Site" },
      });
      expect(result.docs[1]).toEqual({
        slug: "header",
        label: "header",
        data: { id: "2", logo: "logo.png" },
      });
    });

    it("should call singleEntryService.get for each single slug", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [makeRegistryRecord("site-settings")],
        total: 1,
      });
      mocks.singleEntryService.get.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: { id: "1" },
      });

      await nextly.findGlobals();

      expect(mocks.singleEntryService.get).toHaveBeenCalledWith(
        "site-settings",
        expect.objectContaining({ overrideAccess: true })
      );
    });

    it("should forward depth and locale to singleEntryService.get", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [makeRegistryRecord("site-settings")],
        total: 1,
      });
      mocks.singleEntryService.get.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: { id: "1" },
      });

      await nextly.findGlobals({ depth: 2, locale: "en" });

      expect(mocks.singleEntryService.get).toHaveBeenCalledWith(
        "site-settings",
        expect.objectContaining({ depth: 2, locale: "en" })
      );
    });

    it("should pass source filter to the registry service", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [],
        total: 0,
      });

      await nextly.findGlobals({ source: "code" });

      expect(mocks.singleRegistryService.listSingles).toHaveBeenCalledWith(
        expect.objectContaining({ source: "code" })
      );
    });

    it("should pass search filter to the registry service", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [],
        total: 0,
      });

      await nextly.findGlobals({ search: "settings" });

      expect(mocks.singleRegistryService.listSingles).toHaveBeenCalledWith(
        expect.objectContaining({ search: "settings" })
      );
    });

    it("should pass limit and offset to the registry service", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [],
        total: 10,
      });

      const result = await nextly.findGlobals({ limit: 5, offset: 5 });

      expect(mocks.singleRegistryService.listSingles).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, offset: 5 })
      );
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(5);
      expect(result.totalDocs).toBe(10);
    });

    it("should pass migrationStatus and locked filters", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [],
        total: 0,
      });

      await nextly.findGlobals({ migrationStatus: "pending", locked: false });

      expect(mocks.singleRegistryService.listSingles).toHaveBeenCalledWith(
        expect.objectContaining({ migrationStatus: "pending", locked: false })
      );
    });

    it("should return empty result when no singles registered", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [],
        total: 0,
      });

      const result = await nextly.findGlobals();

      expect(result.docs).toEqual([]);
      expect(result.totalDocs).toBe(0);
      expect(result.limit).toBe(0);
      expect(result.offset).toBe(0);
    });

    it("should default limit to result length when not specified", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [
          makeRegistryRecord("site-settings"),
          makeRegistryRecord("header"),
        ],
        total: 2,
      });
      mocks.singleEntryService.get.mockResolvedValue({
        success: true,
        statusCode: 200,
        data: { id: "1" },
      });

      const result = await nextly.findGlobals();

      expect(result.limit).toBe(2);
    });

    it("should throw NextlyError when registry service fails", async () => {
      // Services throw NextlyError directly (post-PR-4); the namespace
      // passes it through unchanged after `convertServiceError` was deleted.
      mocks.singleRegistryService.listSingles.mockRejectedValue(
        new DatabaseError("Database connection failed")
      );

      await expect(nextly.findGlobals()).rejects.toThrow(NextlyError);
    });

    it("should throw NotFoundError when a single entry fetch returns 404", async () => {
      mocks.singleRegistryService.listSingles.mockResolvedValue({
        data: [makeRegistryRecord("missing-single")],
        total: 1,
      });
      mocks.singleEntryService.get.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Single not found",
      });

      await expect(nextly.findGlobals()).rejects.toThrow(NotFoundError);
    });
  });
});

/**
 * Direct API - Forms Namespace Tests
 *
 * Tests: forms.find, forms.findBySlug, forms.submit, forms.submissions
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { Nextly } from "../nextly";

import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

describe("Direct API - Forms Operations", () => {
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

  describe("forms.find()", () => {
    it("should return paginated forms", async () => {
      const mockData = {
        docs: [
          {
            id: "f1",
            name: "Contact Form",
            slug: "contact",
            status: "published",
          },
        ],
        totalDocs: 1,
        limit: 10,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      };
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: mockData,
      });

      const result = await nextly.forms.find();

      expect(result).toEqual(mockData);
      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "forms",
        })
      );
    });

    it("should pass status filter as where clause", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { docs: [], totalDocs: 0 },
      });

      await nextly.forms.find({ status: "published" });

      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { equals: "published" } },
        })
      );
    });

    it("should pass limit and page", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { docs: [] },
      });

      await nextly.forms.find({ limit: 5, page: 3 });

      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 5,
          page: 3,
        })
      );
    });

    it("should throw on failure", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: false,
        statusCode: 500,
        message: "Database error",
        data: null,
      });

      await expect(nextly.forms.find()).rejects.toThrow(NextlyError);
    });
  });

  describe("forms.findBySlug()", () => {
    it("should return form when found", async () => {
      const mockForm = { id: "f1", name: "Contact", slug: "contact" };
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [mockForm],
          totalDocs: 1,
        },
      });

      const result = await nextly.forms.findBySlug({ slug: "contact" });

      expect(result).toEqual(mockForm);
      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "forms",
          where: { slug: { equals: "contact" } },
          limit: 1,
        })
      );
    });

    it("should return null with disableErrors when not found", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [],
          totalDocs: 0,
        },
      });

      const result = await nextly.forms.findBySlug({
        slug: "nonexistent",
        disableErrors: true,
      });

      expect(result).toBeNull();
    });

    it("should throw NextlyError(NOT_FOUND) without disableErrors", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [],
          totalDocs: 0,
        },
      });

      await expect(
        nextly.forms.findBySlug({ slug: "nonexistent" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("should throw when slug is missing", async () => {
      await expect(nextly.forms.findBySlug({ slug: "" })).rejects.toThrow(
        "'slug' is required"
      );
    });
  });

  describe("forms.submit()", () => {
    it("should submit form data and return result", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [
            {
              id: "form-1",
              slug: "contact",
              status: "published",
              settings: {},
            },
          ],
          totalDocs: 1,
        },
      });

      mocks.collectionsHandler.createEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Created",
        data: { id: "sub-1", form: "form-1", data: { name: "John" } },
      });

      const result = await nextly.forms.submit({
        form: "contact",
        data: { name: "John", email: "john@test.com" },
      });

      expect(result.success).toBe(true);
      expect(result.submission).toBeDefined();
      expect(result.submission?.id).toBe("sub-1");
    });

    it("should return redirect URL when form has redirect setting", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [
            {
              id: "form-1",
              slug: "contact",
              status: "published",
              settings: {
                confirmationType: "redirect",
                redirectUrl: "https://example.com/thank-you",
              },
            },
          ],
          totalDocs: 1,
        },
      });
      mocks.collectionsHandler.createEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Created",
        data: { id: "sub-1" },
      });

      const result = await nextly.forms.submit({
        form: "contact",
        data: { message: "Hello" },
      });

      expect(result.success).toBe(true);
      expect(result.redirect).toBe("https://example.com/thank-you");
    });

    it("should return error when form not found", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { docs: [], totalDocs: 0 },
      });

      const result = await nextly.forms.submit({
        form: "nonexistent",
        data: { name: "Test" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Form not found");
    });

    it("should return error when form is not published", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [
            {
              id: "form-1",
              slug: "draft-form",
              status: "draft",
            },
          ],
          totalDocs: 1,
        },
      });

      const result = await nextly.forms.submit({
        form: "draft-form",
        data: { name: "Test" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not currently accepting submissions");
    });

    it("should throw when form slug is missing", async () => {
      await expect(
        nextly.forms.submit({ form: "", data: { name: "Test" } })
      ).rejects.toThrow("'form' (slug) is required");
    });

    it("should throw when data is missing", async () => {
      await expect(
        nextly.forms.submit({ form: "contact", data: null as any })
      ).rejects.toThrow("'data' is required");
    });

    it("should include metadata in submission", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [
            {
              id: "form-1",
              slug: "contact",
              status: "published",
              settings: {},
            },
          ],
          totalDocs: 1,
        },
      });
      mocks.collectionsHandler.createEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Created",
        data: { id: "sub-1" },
      });

      await nextly.forms.submit({
        form: "contact",
        data: { name: "Test" },
        metadata: {
          ipAddress: "127.0.0.1",
          userAgent: "Test/1.0",
        },
      });

      expect(mocks.collectionsHandler.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "form-submissions",
        }),
        expect.objectContaining({
          ipAddress: "127.0.0.1",
          userAgent: "Test/1.0",
        })
      );
    });
  });

  describe("forms.submissions()", () => {
    it("should return paginated submissions for form ID", async () => {
      const mockData = {
        docs: [{ id: "sub-1", form: "form-uuid", data: { name: "John" } }],
        totalDocs: 1,
        limit: 10,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      };
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: mockData,
      });

      // Use a UUID-like value so looksLikeId returns true
      const result = await nextly.forms.submissions({
        form: "550e8400-e29b-41d4-a716-446655440000",
      });

      expect(result).toEqual(mockData);
      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "form-submissions",
          where: { form: { equals: "550e8400-e29b-41d4-a716-446655440000" } },
        })
      );
    });

    it("should resolve form slug to ID before querying", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [{ id: "form-uuid-123", slug: "contact" }],
          totalDocs: 1,
        },
      });
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [{ id: "sub-1", form: "form-uuid-123" }],
          totalDocs: 1,
        },
      });

      await nextly.forms.submissions({ form: "contact" });

      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledTimes(2);
      const secondCall = mocks.collectionsHandler.listEntries.mock.calls[1][0];
      expect(secondCall.where).toEqual({ form: { equals: "form-uuid-123" } });
    });

    it("should throw when form slug is missing", async () => {
      await expect(nextly.forms.submissions({ form: "" })).rejects.toThrow(
        "'form' (slug or ID) is required"
      );
    });

    it("should throw NextlyError(NOT_FOUND) when slug doesn't resolve", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { docs: [], totalDocs: 0 },
      });

      await expect(
        nextly.forms.submissions({ form: "nonexistent-form" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("should pass limit and page", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { docs: [], totalDocs: 0 },
      });

      await nextly.forms.submissions({
        form: "550e8400-e29b-41d4-a716-446655440000",
        limit: 20,
        page: 3,
      });

      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          page: 3,
        })
      );
    });
  });
});

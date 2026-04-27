// Tests for DrizzlePushService - wraps drizzle-kit/api pushSchema()
// with preview (dry-run) and apply functionality.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { DrizzlePushService } from "../services/drizzle-push-service";

// Mock drizzle-kit-api wrapper
const mockApply = vi.fn().mockResolvedValue(undefined);
const mockPushResult = {
  hasDataLoss: false,
  warnings: [] as string[],
  statementsToExecute: [] as string[],
  apply: mockApply,
};

vi.mock("../../../database/drizzle-kit-api", () => ({
  requireDrizzleKit: () => ({
    pushSchema: vi.fn().mockResolvedValue(mockPushResult),
  }),
  requireDrizzleKitMySQL: () => ({
    pushSchema: vi.fn().mockResolvedValue(mockPushResult),
  }),
  requireDrizzleKitSQLite: () => ({
    pushSchema: vi.fn().mockResolvedValue(mockPushResult),
  }),
}));

describe("DrizzlePushService", () => {
  let service: DrizzlePushService;
  const mockDb = {} as unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DrizzlePushService("postgresql", mockDb);
  });

  describe("preview", () => {
    it("returns schema diff without applying changes", async () => {
      const schema = { dc_products: {} };
      const result = await service.preview(schema);

      expect(result).toHaveProperty("hasDataLoss");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("statementsToExecute");
      expect(result.applied).toBe(false);
    });

    it("does not call apply()", async () => {
      const schema = { dc_products: {} };
      await service.preview(schema);
      expect(mockApply).not.toHaveBeenCalled();
    });
  });

  describe("apply", () => {
    it("applies schema changes and returns result", async () => {
      const schema = { dc_products: {} };
      const result = await service.apply(schema);

      expect(result.applied).toBe(true);
      expect(mockApply).toHaveBeenCalledOnce();
    });
  });

  describe("previewAndApply", () => {
    it("returns preview without applying when dryRun is true", async () => {
      const schema = { dc_products: {} };
      const result = await service.previewAndApply(schema, { dryRun: true });

      expect(result.applied).toBe(false);
      expect(mockApply).not.toHaveBeenCalled();
    });

    it("applies changes when dryRun is false", async () => {
      const schema = { dc_products: {} };
      const result = await service.previewAndApply(schema, { dryRun: false });

      expect(result.applied).toBe(true);
      expect(mockApply).toHaveBeenCalledOnce();
    });

    it("applies changes when dryRun is not specified", async () => {
      const schema = { dc_products: {} };
      const result = await service.previewAndApply(schema);

      expect(result.applied).toBe(true);
      expect(mockApply).toHaveBeenCalledOnce();
    });
  });

  describe("dialect selection", () => {
    it("creates service for mysql dialect", () => {
      const mysqlService = new DrizzlePushService("mysql", mockDb);
      expect(mysqlService).toBeDefined();
    });

    it("creates service for sqlite dialect", () => {
      const sqliteService = new DrizzlePushService("sqlite", mockDb);
      expect(sqliteService).toBeDefined();
    });
  });
});

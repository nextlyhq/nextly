import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { healthCheck, type HealthCheckResult } from "./health";

// Mock the drizzle db module
vi.mock("./drizzle", () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock the env module
vi.mock("../lib/env", () => ({
  env: {
    DB_DIALECT: "postgresql",
  },
}));

// Mock the logger
vi.mock("../lib/logger", () => ({
  logDbConn: vi.fn(),
  nowMs: vi.fn(() => Date.now()),
}));

describe("healthCheck()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful health checks", () => {
    it("should return ok:true when database query succeeds", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(true);
      expect(result.database.connected).toBe(true);
      expect(result.database.dialect).toBe("postgresql");
      expect(result.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should measure query latency accurately", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const { nowMs } = await import("../lib/logger");

      let callCount = 0;
      (nowMs as any).mockImplementation(() => {
        // First call: start time (1000ms)
        // Second call: end time (1050ms) - 50ms latency
        callCount++;
        return callCount === 1 ? 1000 : 1050;
      });

      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(true);
      expect(result.database.latencyMs).toBe(50);
    });

    it("should include timestamp in ISO format", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.timestamp).toBeDefined();
      const timestampDate = new Date(result.timestamp);
      expect(timestampDate).toBeInstanceOf(Date);
      expect(timestampDate.getTime()).not.toBeNaN();
    });

    it("should include dialect information", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.database.dialect).toBe("postgresql");
    });
  });

  describe("failed health checks", () => {
    it("should return ok:false when database query fails", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const testError = new Error("Connection timeout");
      (db.execute as any).mockRejectedValueOnce(testError);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.database.connected).toBe(false);
      expect(result.error).toBe("Connection timeout");
    });

    it("should include error message in response", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockRejectedValueOnce(
        new Error("Database connection refused")
      );

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Database connection refused");
    });

    it("should measure latency even when query fails", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const { nowMs } = await import("../lib/logger");

      let callCount = 0;
      (nowMs as any).mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1000 : 1100; // 100ms latency
      });

      (db.execute as any).mockRejectedValueOnce(new Error("Query timeout"));

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.database.latencyMs).toBe(100);
    });

    it("should handle non-Error exceptions", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockRejectedValueOnce("String error");

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error).toBe("String error");
    });

    it("should handle null/undefined exceptions", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockRejectedValueOnce(null);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
    });
  });

  describe("logging behavior", () => {
    it("should log success when query succeeds", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const { logDbConn } = await import("../lib/logger");
      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      await healthCheck();

      // Assert
      expect(logDbConn).toHaveBeenCalledWith(
        "info",
        expect.objectContaining({
          op: "health-ok",
          dialect: "postgresql",
        })
      );
    });

    it("should log error when query fails", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const { logDbConn } = await import("../lib/logger");
      (db.execute as any).mockRejectedValueOnce(new Error("Failed"));

      // Act
      await healthCheck();

      // Assert
      expect(logDbConn).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          op: "health-fail",
          dialect: "postgresql",
          errorMessage: "Failed",
        })
      );
    });
  });

  describe("return type validation", () => {
    it("should match HealthCheckResult interface when healthy", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      const result: HealthCheckResult = await healthCheck();

      // Assert - TypeScript compilation validates the interface
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("database");
      expect(result.database).toHaveProperty("connected");
      expect(result.database).toHaveProperty("dialect");
      expect(result.database).toHaveProperty("latencyMs");
    });

    it("should match HealthCheckResult interface when unhealthy", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockRejectedValueOnce(new Error("Failed"));

      // Act
      const result: HealthCheckResult = await healthCheck();

      // Assert - TypeScript compilation validates the interface
      expect(result).toHaveProperty("ok");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("database");
      expect(result).toHaveProperty("error");
      expect(result.ok).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle database returning null result", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce(null);

      // Act
      const result = await healthCheck();

      // Assert - Query resolved without error, so health check should succeed
      expect(result.ok).toBe(true);
      expect(result.database.connected).toBe(true);
      expect(result.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle database returning undefined result", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce(undefined);

      // Act
      const result = await healthCheck();

      // Assert - Query resolved without error, so health check should succeed
      expect(result.ok).toBe(true);
      expect(result.database.connected).toBe(true);
      expect(result.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle database returning empty array", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValueOnce([]);

      // Act
      const result = await healthCheck();

      // Assert - Query resolved without error, so health check should succeed
      expect(result.ok).toBe(true);
      expect(result.database.connected).toBe(true);
      expect(result.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should handle errors without message property", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      // Create error-like object without standard Error properties
      (db.execute as any).mockRejectedValueOnce({ code: "ECONNREFUSED" });

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Unknown database error");
    });

    it("should handle Error objects with stack traces", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const { logDbConn } = await import("../lib/logger");
      const testError = new Error("Connection failed");
      testError.stack = "Error: Connection failed\n    at test.ts:123:45";
      (db.execute as any).mockRejectedValueOnce(testError);

      // Act
      const result = await healthCheck();

      // Assert
      expect(result.ok).toBe(false);
      expect(result.error).toBe("Connection failed");
      // Verify stack trace is logged
      expect(logDbConn).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({
          op: "health-fail",
          errorMessage: "Connection failed",
          errorStack: expect.stringContaining("Error: Connection failed"),
        })
      );
    });

    it("should handle very slow queries (high latency)", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      const { nowMs } = await import("../lib/logger");

      let callCount = 0;
      (nowMs as any).mockImplementation(() => {
        callCount++;
        // Simulate 5-second query
        return callCount === 1 ? 1000 : 6000;
      });

      (db.execute as any).mockResolvedValueOnce([{ test: 1 }]);

      // Act
      const result = await healthCheck();

      // Assert - Even slow queries should report success if they complete
      expect(result.ok).toBe(true);
      expect(result.database.latencyMs).toBe(5000);
    });

    it("should handle concurrent health check calls", async () => {
      // Arrange
      const { db } = await import("./drizzle");
      (db.execute as any).mockResolvedValue([{ test: 1 }]);

      // Act - Execute multiple health checks concurrently
      const results = await Promise.all([
        healthCheck(),
        healthCheck(),
        healthCheck(),
      ]);

      // Assert - All should succeed independently
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.ok).toBe(true);
        expect(result.database.connected).toBe(true);
      });
      expect(db.execute).toHaveBeenCalledTimes(3);
    });
  });
});

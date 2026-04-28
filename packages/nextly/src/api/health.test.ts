import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET, HEAD } from "./health";

// Mock the health check function
vi.mock("../database/health", () => ({
  healthCheck: vi.fn(),
}));

describe("Health Check Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET handler", () => {
    it("should return 200 with canonical success body when database is healthy", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: true,
          dialect: "postgresql",
          latencyMs: 5,
        },
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=60, stale-while-revalidate=30"
      );

      // Canonical success shape per spec §10.2: payload is wrapped in `data`.
      const json = await response.json();
      expect(json.data.ok).toBe(true);
      expect(json.data.database.connected).toBe(true);
      expect(json.data.database.latencyMs).toBe(5);
    });

    it("should return 503 with problem+json body when database is unhealthy", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: false,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: false,
          dialect: "postgresql",
          latencyMs: 5002,
        },
        error: "Connection timeout",
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await GET(request);

      // Assert — withErrorHandler converts the SERVICE_UNAVAILABLE throw into
      // the canonical problem+json error shape. Operator detail (latency,
      // dialect, raw error string) is in server logs, not in this body.
      expect(response.status).toBe(503);
      expect(response.headers.get("Content-Type")).toBe(
        "application/problem+json"
      );
      const json = await response.json();
      expect(json.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(json.error.message).toBe(
        "Service unavailable. Please try again later."
      );
      expect(json.error.requestId).toMatch(/^req_/);
    });

    it("should include cache headers", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: true,
          dialect: "postgresql",
          latencyMs: 3,
        },
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await GET(request);

      // Assert
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=60, stale-while-revalidate=30"
      );
    });

    it("should return proper JSON structure", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      const mockHealth = {
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: true,
          dialect: "postgresql",
          latencyMs: 7,
        },
      };
      (healthCheck as any).mockResolvedValueOnce(mockHealth);

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await GET(request);

      // Assert — full body is the canonical `{ data: ... }` envelope.
      const json = await response.json();
      expect(json).toEqual({ data: mockHealth });
    });
  });

  describe("HEAD handler", () => {
    it("should return 200 with no body when database is healthy", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: true,
          dialect: "postgresql",
          latencyMs: 4,
        },
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await HEAD(request);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
    });

    it("should return 503 with no body when database is unhealthy", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: false,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: false,
          dialect: "postgresql",
          latencyMs: 5000,
        },
        error: "Database unreachable",
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await HEAD(request);

      // Assert
      expect(response.status).toBe(503);
      expect(response.body).toBeNull();
    });

    it("should include cache headers", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: true,
          dialect: "mysql",
          latencyMs: 6,
        },
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await HEAD(request);

      // Assert
      expect(response.headers.get("Cache-Control")).toBe(
        "public, max-age=60, stale-while-revalidate=30"
      );
    });

    it("should not return body content", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: {
          connected: true,
          dialect: "postgresql",
          latencyMs: 2,
        },
      });

      // Act
      const request = new Request("http://localhost:3000/api/health");
      const response = await HEAD(request);

      // Assert
      expect(response.body).toBeNull();
    });
  });

  describe("Route handler contract", () => {
    it("GET should accept Request parameter", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: { connected: true, dialect: "postgresql", latencyMs: 3 },
      });

      // Act & Assert - should not throw
      const request = new Request("http://localhost:3000/api/health");
      const response = await GET(request);
      expect(response).toBeInstanceOf(Response);
    });

    it("HEAD should accept Request parameter", async () => {
      // Arrange
      const { healthCheck } = await import("../database/health");
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: { connected: true, dialect: "postgresql", latencyMs: 3 },
      });

      // Act & Assert - should not throw
      const request = new Request("http://localhost:3000/api/health");
      const response = await HEAD(request);
      expect(response).toBeInstanceOf(Response);
    });
  });
});

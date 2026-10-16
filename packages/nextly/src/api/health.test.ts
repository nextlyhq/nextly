import { describe, expect, it, vi, beforeEach } from "vitest";

import { GET, HEAD } from "./health";

// Mock the health check function
vi.mock("../database/health", () => ({
  healthCheck: vi.fn(),
}));

// Whether Nextly has started in this process. Started unless a case says not.
vi.mock("../di/register", () => ({
  isServicesRegistered: vi.fn(() => true),
}));

// A start in flight, which the route waits for. None unless a case says so.
vi.mock("../init", () => ({
  getCachedNextly: vi.fn(async () => {
    throw new Error("Nextly has not been initialised");
  }),
}));

describe("Health Check Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("before Nextly has started in this process", () => {
    it("answers 503 with only the generic body, without probing a database it has no adapter for", async () => {
      const { healthCheck } = await import("../database/health");
      const { isServicesRegistered } = await import("../di/register");
      (isServicesRegistered as any).mockReturnValueOnce(false);

      const response = await GET(
        new Request("http://localhost:3000/api/health")
      );

      expect(response.status).toBe(503);
      const json = await response.json();
      expect(Object.keys(json)).toEqual(["error"]);
      expect(Object.keys(json.error).sort()).toEqual([
        "code",
        "message",
        "requestId",
      ]);
      expect(json.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(json.error.message).toBe(
        "Service unavailable. Please try again later."
      );
      expect(healthCheck).not.toHaveBeenCalled();
    });

    it("logs once per process however often a monitor polls, not once per poll", async () => {
      // A fresh copy of the route, so this process has not yet said why.
      vi.resetModules();
      const { setNextlyLogger } = await import("../observability/logger");
      const { isServicesRegistered } = await import("../di/register");
      const route = await import("./health");
      const lines: object[] = [];
      const record = (payload: object) => {
        lines.push(payload);
      };
      setNextlyLogger({
        error: record,
        warn: record,
        info: record,
        debug: record,
      });
      (isServicesRegistered as any).mockReturnValue(false);

      try {
        for (let poll = 0; poll < 3; poll++) {
          const response = await route.GET(
            new Request("http://localhost:3000/api/health")
          );
          expect(response.status).toBe(503);
        }
      } finally {
        setNextlyLogger(undefined);
        (isServicesRegistered as any).mockReturnValue(true);
      }

      expect(lines).toEqual([
        expect.objectContaining({ op: "health-not-started" }),
      ]);
    });

    it("waits for a start already under way, and answers for the server once it has started", async () => {
      // A route can run before instrumentation.register() has finished; the
      // probe then waits for that start instead of answering 503.
      const { healthCheck } = await import("../database/health");
      const { isServicesRegistered } = await import("../di/register");
      const { getCachedNextly } = await import("../init");
      (isServicesRegistered as any).mockReturnValueOnce(false);
      (getCachedNextly as any).mockResolvedValueOnce({});
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: { connected: true, dialect: "sqlite", latencyMs: 1 },
      });

      const response = await GET(
        new Request("http://localhost:3000/api/health")
      );

      expect(getCachedNextly).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    });

    it("still answers 503 when the logger cannot write the warning", async () => {
      vi.resetModules();
      const { setNextlyLogger } = await import("../observability/logger");
      const { isServicesRegistered } = await import("../di/register");
      const route = await import("./health");
      const fails = () => {
        throw new Error("log transport unavailable");
      };
      setNextlyLogger({ error: fails, warn: fails, info: fails, debug: fails });
      (isServicesRegistered as any).mockReturnValue(false);

      try {
        const get = await route.GET(
          new Request("http://localhost:3000/api/health")
        );
        const head = await route.HEAD(
          new Request("http://localhost:3000/api/health", { method: "HEAD" })
        );
        expect(get.status).toBe(503);
        expect((await get.json()).error.code).toBe("SERVICE_UNAVAILABLE");
        expect(head.status).toBe(503);
      } finally {
        setNextlyLogger(undefined);
        (isServicesRegistered as any).mockReturnValue(true);
      }
    });

    it("answers HEAD with 503 too", async () => {
      const { isServicesRegistered } = await import("../di/register");
      (isServicesRegistered as any).mockReturnValueOnce(false);

      const response = await HEAD(
        new Request("http://localhost:3000/api/health")
      );

      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
    });
  });

  describe("GET handler", () => {
    it("should return 200 with bare respondData body when database is healthy", async () => {
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

      // respondData emits a bare body. Health-check fields are spread
      // alongside `version` and `uptime` so the payload is never Boolean-only
      // (spec §5.1 rule 3 / §7.7).
      const json = await response.json();
      expect(json).not.toHaveProperty("data");
      expect(json.ok).toBe(true);
      expect(json.database.connected).toBe(true);
      expect(json.database.latencyMs).toBe(5);
      expect(typeof json.version).toBe("string");
      expect(typeof json.uptime).toBe("number");
      expect(json.uptime).toBeGreaterThanOrEqual(0);
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

      // Assert: bare body has the original probe fields plus version + uptime.
      // We only assert the structural keys here because `version` reads from
      // `process.env.npm_package_version` (varies per launch mode) and
      // `uptime` is wall-clock dependent.
      const json = await response.json();
      expect(json).not.toHaveProperty("data");
      expect(json.ok).toBe(mockHealth.ok);
      expect(json.timestamp).toBe(mockHealth.timestamp);
      expect(json.database).toEqual(mockHealth.database);
      expect(json).toHaveProperty("version");
      expect(json).toHaveProperty("uptime");
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

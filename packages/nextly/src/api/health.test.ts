import { describe, expect, it, vi, beforeEach } from "vitest";

import { isServicesRegistered } from "../di/service-access";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";

import { GET, HEAD } from "./health";

// Mock the health check function
vi.mock("../database/health", () => ({
  healthCheck: vi.fn(),
}));

// Whether services are registered in this process. Registered unless a case says not.
vi.mock("../di/service-access", () => ({
  isServicesRegistered: vi.fn(() => true),
}));

// Where Nextly stands, as init answers it. Started unless a case says otherwise.
vi.mock("../init", () => ({
  getCachedNextly: vi.fn(async () => ({})),
}));

/** What init answers when nothing has started Nextly in the process. */
const neverStarted = () =>
  new NextlyError({
    code: "CONFIGURATION_ERROR",
    statusCode: 500,
    publicMessage: "Server configuration error.",
    logMessage: "getCachedNextly() called before initialization.",
  });

/** Puts the mocks in the state of a process nothing has started Nextly in. */
async function notStarted(how: "once" | "always"): Promise<void> {
  const { isServicesRegistered } = await import("../di/service-access");
  const { getCachedNextly } = await import("../init");
  if (how === "once") {
    (isServicesRegistered as any).mockReturnValueOnce(false);
    (getCachedNextly as any).mockRejectedValueOnce(neverStarted());
  } else {
    (isServicesRegistered as any).mockReturnValue(false);
    (getCachedNextly as any).mockRejectedValue(neverStarted());
  }
}

describe("Health Check Route Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A case that sets a lasting answer must not leave it for the next one.
    vi.mocked(isServicesRegistered).mockReturnValue(true);
    vi.mocked(getCachedNextly).mockImplementation(async () => ({}) as never);
  });

  describe("before Nextly has started in this process", () => {
    it("answers 503 with only the generic body, without probing a database it has no adapter for", async () => {
      const { healthCheck } = await import("../database/health");
      await notStarted("once");

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
      await notStarted("always");

      try {
        for (let poll = 0; poll < 3; poll++) {
          const response = await route.GET(
            new Request("http://localhost:3000/api/health")
          );
          expect(response.status).toBe(503);
        }
      } finally {
        setNextlyLogger(undefined);
        vi.clearAllMocks();
      }

      expect(lines).toEqual([
        expect.objectContaining({ op: "health-not-started" }),
      ]);
    });

    it("still answers 503 when the logger cannot write the warning", async () => {
      vi.resetModules();
      const { setNextlyLogger } = await import("../observability/logger");
      const route = await import("./health");
      const fails = () => {
        throw new Error("log transport unavailable");
      };
      setNextlyLogger({ error: fails, warn: fails, info: fails, debug: fails });
      await notStarted("always");

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
        vi.clearAllMocks();
      }
    });

    it("answers HEAD with 503 too", async () => {
      await notStarted("once");

      const response = await HEAD(
        new Request("http://localhost:3000/api/health")
      );

      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
    });
  });

  describe("while Nextly is starting", () => {
    it("answers only once the start has finished, even after services have registered", async () => {
      // Services register partway through a start; drift checks, boot apply
      // and seeding come after. The probe waits for all of it.
      const { healthCheck } = await import("../database/health");
      const { getCachedNextly } = await import("../init");
      let finish: () => void = () => {};
      (getCachedNextly as any).mockReturnValueOnce(
        new Promise(resolve => {
          finish = () => resolve({});
        })
      );
      (healthCheck as any).mockResolvedValueOnce({
        ok: true,
        timestamp: "2025-01-15T10:30:00.000Z",
        database: { connected: true, dialect: "sqlite", latencyMs: 1 },
      });

      const answer = GET(new Request("http://localhost:3000/api/health"));
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(healthCheck).not.toHaveBeenCalled();

      finish();
      expect((await answer).status).toBe(200);
    });

    it("logs a start that fails after an earlier probe already reported it not started", async () => {
      // One process: a probe before the start, then the start fails. The
      // failure is the detail an operator needs, and must not be swallowed by
      // the earlier report.
      vi.resetModules();
      const { setNextlyLogger } = await import("../observability/logger");
      const { isServicesRegistered } = await import("../di/service-access");
      const { getCachedNextly } = await import("../init");
      const { NextlyError: RouteNextlyError } = await import(
        "../errors/nextly-error"
      );
      const route = await import("./health");
      const lines: Array<Record<string, unknown>> = [];
      const record = (payload: object) => {
        lines.push(payload as Record<string, unknown>);
      };
      setNextlyLogger({
        error: record,
        warn: record,
        info: record,
        debug: record,
      });

      try {
        vi.mocked(isServicesRegistered).mockReturnValue(false);
        vi.mocked(getCachedNextly).mockRejectedValueOnce(
          new RouteNextlyError({
            code: "CONFIGURATION_ERROR",
            statusCode: 500,
            publicMessage: "Server configuration error.",
          })
        );
        await route.GET(new Request("http://localhost:3000/api/health"));

        vi.mocked(getCachedNextly).mockRejectedValueOnce(
          RouteNextlyError.serviceUnavailable({
            logMessage: "Boot migrations refused: 2 pending",
          })
        );
        await route.GET(new Request("http://localhost:3000/api/health"));
      } finally {
        setNextlyLogger(undefined);
      }

      expect(lines.map(line => line.op)).toEqual([
        "health-not-started",
        "health-start-failed",
      ]);
    });

    it("answers 503 for a start that failed, and logs the failure itself rather than a missing hook", async () => {
      vi.resetModules();
      const { setNextlyLogger } = await import("../observability/logger");
      const { getCachedNextly } = await import("../init");
      const { NextlyError: RouteNextlyError } = await import(
        "../errors/nextly-error"
      );
      const route = await import("./health");
      const lines: Array<Record<string, unknown>> = [];
      const record = (payload: object) => {
        lines.push(payload as Record<string, unknown>);
      };
      setNextlyLogger({
        error: record,
        warn: record,
        info: record,
        debug: record,
      });
      (getCachedNextly as any).mockRejectedValueOnce(
        RouteNextlyError.serviceUnavailable({
          logMessage: "Boot migrations refused: 2 pending",
        })
      );

      try {
        const response = await route.GET(
          new Request("http://localhost:3000/api/health")
        );
        expect(response.status).toBe(503);
        expect((await response.json()).error.message).toBe(
          "Service unavailable. Please try again later."
        );
      } finally {
        setNextlyLogger(undefined);
      }

      expect(lines).toEqual([
        expect.objectContaining({
          op: "health-start-failed",
          detail: "Boot migrations refused: 2 pending",
        }),
      ]);
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

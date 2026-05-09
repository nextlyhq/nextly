import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createNextlyInstrumentation } from "./instrumentation";
import { setNextlyLogger, getNextlyLogger, type NextlyLogger } from "./logger";
import {
  setGlobalOnError,
  getGlobalOnError,
  type OnErrorHook,
} from "./on-error";

let mockLogger: NextlyLogger;

beforeEach(() => {
  mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
});

afterEach(() => {
  setNextlyLogger(undefined);
  setGlobalOnError(undefined);
});

describe("createNextlyInstrumentation", () => {
  it("registers the provided logger via setNextlyLogger", () => {
    createNextlyInstrumentation({ logger: mockLogger });
    expect(getNextlyLogger()).toBe(mockLogger);
  });

  it("registers the provided onError hook via setGlobalOnError", () => {
    const onError = vi.fn() satisfies OnErrorHook;
    createNextlyInstrumentation({ onError });
    expect(getGlobalOnError()).toBe(onError);
  });

  it("works with no options (no-op registration)", () => {
    const inst = createNextlyInstrumentation();
    expect(typeof inst.onRequestError).toBe("function");
  });

  describe("onRequestError", () => {
    it("logs framework-level errors with digest, route, and a request id", async () => {
      const inst = createNextlyInstrumentation({ logger: mockLogger });

      const err = Object.assign(new Error("boom"), { digest: "abc123" });
      await inst.onRequestError(
        err,
        {
          path: "/api/x",
          method: "GET",
          headers: new Headers({ "x-request-id": "req_test_upstream" }),
        },
        { routerKind: "App Router", routePath: "/api/x", routeType: "route" }
      );

      expect(mockLogger.error).toHaveBeenCalledOnce();
      const payload = (mockLogger.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(payload).toMatchObject({
        kind: "next.requestError",
        requestId: "req_test_upstream",
        digest: "abc123",
        path: "/api/x",
        method: "GET",
      });
    });

    it("falls back to req_unknown when no recognized request-id header is present", async () => {
      const inst = createNextlyInstrumentation({ logger: mockLogger });

      await inst.onRequestError(
        new Error("boom"),
        { path: "/api/x", method: "GET", headers: new Headers() },
        { routerKind: "App Router", routePath: "/api/x", routeType: "route" }
      );

      const payload = (mockLogger.error as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(payload.requestId).toBe("req_unknown");
    });

    it("invokes the global onError hook with framework kind", async () => {
      const onError = vi.fn() satisfies OnErrorHook;
      const inst = createNextlyInstrumentation({ logger: mockLogger, onError });

      await inst.onRequestError(
        new Error("boom"),
        {
          path: "/api/x",
          method: "GET",
          headers: new Headers({ "x-request-id": "req_t" }),
        },
        { routerKind: "App Router", routePath: "/api/x", routeType: "route" }
      );

      expect(onError).toHaveBeenCalledOnce();
      const [, ctx] = onError.mock.calls[0];
      expect(ctx).toEqual({ kind: "framework", requestId: "req_t" });
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DbError } from "../database/errors";
import { NextlyError } from "../errors/nextly-error";
import { setNextlyLogger, type NextlyLogger } from "../observability/logger";
import { setGlobalOnError, type OnErrorHook } from "../observability/on-error";

import { withErrorHandler } from "./with-error-handler";

let mockLogger: NextlyLogger;

beforeEach(() => {
  mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  setNextlyLogger(mockLogger);
  setGlobalOnError(undefined);
});

afterEach(() => {
  setNextlyLogger(undefined);
  setGlobalOnError(undefined);
});

describe("withErrorHandler — happy path", () => {
  it("passes a successful Response through and attaches X-Request-Id", async () => {
    const handler = withErrorHandler(async () =>
      Response.json({ data: { ok: true } })
    );
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^req_[a-z2-7]{16}$/);
    expect(await res.json()).toEqual({ data: { ok: true } });
  });

  it("preserves an upstream X-Request-Id from the request", async () => {
    const handler = withErrorHandler(async () => Response.json({ data: {} }));
    const res = await handler(
      new Request("http://localhost/api/x", {
        headers: { "x-request-id": "req_upstream0000001" },
      })
    );
    expect(res.headers.get("x-request-id")).toBe("req_upstream0000001");
  });

  it("preserves an existing X-Request-Id on the response if the handler set one", async () => {
    const handler = withErrorHandler(async () => {
      const res = Response.json({ data: {} });
      res.headers.set("x-request-id", "req_handler0000001");
      return res;
    });
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.headers.get("x-request-id")).toBe("req_handler0000001");
  });

  it("forwards through dynamic-route handlers with params", async () => {
    const handler = withErrorHandler(
      async (
        _req: Request,
        { params }: { params: Promise<{ id: string }> }
      ) => {
        const { id } = await params;
        return Response.json({ data: { id } });
      }
    );
    const res = await handler(new Request("http://localhost/api/x/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect((await res.json()).data.id).toBe("abc");
  });
});

describe("withErrorHandler — error path", () => {
  it("serializes NextlyError to canonical wire shape with problem+json", async () => {
    const handler = withErrorHandler(async () => {
      throw NextlyError.notFound({
        logContext: { entity: "post", id: "p_99" },
      });
    });
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json"
    );
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Not found.",
        requestId: expect.stringMatching(/^req_/),
      },
    });
    expect(body.error).not.toHaveProperty("stack");
    expect(body.error).not.toHaveProperty("logContext");
    expect(body.error).not.toHaveProperty("cause");
  });

  it("includes data field for VALIDATION_ERROR responses", async () => {
    const handler = withErrorHandler(async () => {
      throw NextlyError.validation({
        errors: [
          {
            path: "email",
            code: "INVALID_FORMAT",
            message: "Must be a valid email address.",
          },
        ],
      });
    });
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.data).toEqual({
      errors: [
        {
          path: "email",
          code: "INVALID_FORMAT",
          message: "Must be a valid email address.",
        },
      ],
    });
  });

  it("sets Retry-After header on RATE_LIMITED responses", async () => {
    const handler = withErrorHandler(async () => {
      throw NextlyError.rateLimited({ retryAfterSeconds: 60 });
    });
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("wraps an unknown Error as INTERNAL_ERROR with generic public message", async () => {
    const handler = withErrorHandler(async () => {
      throw new TypeError("internal boom");
    });
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("An unexpected error occurred.");
    expect(body.error.message).not.toContain("internal boom");
    expect(body.error).not.toHaveProperty("stack");
    expect(body.error).not.toHaveProperty("cause");
    expect(body.error).not.toHaveProperty("data");
    expect(body.error).not.toHaveProperty("logContext");
  });

  it("respects a custom internalErrorMessage option", async () => {
    const handler = withErrorHandler(
      async () => {
        throw new TypeError("boom");
      },
      { internalErrorMessage: "Service temporarily unavailable." }
    );
    const res = await handler(new Request("http://localhost/api/x"));
    const body = await res.json();
    expect(body.error.message).toBe("Service temporarily unavailable.");
  });

  it("converts a stray DbError via fromDatabaseError safety net", async () => {
    const handler = withErrorHandler(async () => {
      throw new DbError({
        message: "duplicate key",
        kind: "unique-violation",
        dialect: "postgresql",
        cause: new Error("driver"),
      });
    });
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("DUPLICATE");
    expect(body.error.message).toBe("Resource already exists.");
    // Logged warning that the DB layer should have converted earlier.
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("withErrorHandler — unstable_rethrow", () => {
  // Use the real redirect() / notFound() rather than synthesizing the
  // sentinel digest format. The exact digest format is internal to Next.js
  // and has changed between major versions; calling the real APIs keeps
  // the tests honest across upgrades.

  it("re-throws Next.js redirect() sentinel via unstable_rethrow", async () => {
    const { redirect } = await import("next/navigation");
    const handler = withErrorHandler(async () => {
      redirect("/login");
    });
    await expect(
      handler(new Request("http://localhost/api/x"))
    ).rejects.toThrow();
  });

  it("re-throws Next.js notFound() sentinel via unstable_rethrow", async () => {
    const { notFound } = await import("next/navigation");
    const handler = withErrorHandler(async () => {
      notFound();
    });
    await expect(
      handler(new Request("http://localhost/api/x"))
    ).rejects.toThrow();
  });
});

describe("withErrorHandler — onError hooks", () => {
  it("calls per-call onError hook with route-handler kind", async () => {
    const onError = vi.fn() satisfies OnErrorHook;
    const handler = withErrorHandler(
      async () => {
        throw NextlyError.forbidden();
      },
      { onError }
    );
    await handler(new Request("http://localhost/api/x", { method: "POST" }));
    expect(onError).toHaveBeenCalledOnce();
    const [err, ctx] = onError.mock.calls[0];
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(ctx).toMatchObject({
      kind: "route-handler",
      method: "POST",
      route: "/api/x",
    });
    expect(ctx.requestId).toMatch(/^req_/);
  });

  it("calls global onError hook when set", async () => {
    const globalHook = vi.fn() satisfies OnErrorHook;
    setGlobalOnError(globalHook);
    const handler = withErrorHandler(async () => {
      throw NextlyError.forbidden();
    });
    await handler(new Request("http://localhost/api/x"));
    expect(globalHook).toHaveBeenCalledOnce();
  });

  it("calls per-call before global, both fire on a single error", async () => {
    const calls: string[] = [];
    const perCall: OnErrorHook = () => {
      calls.push("per-call");
    };
    const global: OnErrorHook = () => {
      calls.push("global");
    };
    setGlobalOnError(global);
    const handler = withErrorHandler(
      async () => {
        throw NextlyError.forbidden();
      },
      { onError: perCall }
    );
    await handler(new Request("http://localhost/api/x"));
    expect(calls).toEqual(["per-call", "global"]);
  });

  it("a failing onError hook does not poison the response", async () => {
    const handler = withErrorHandler(
      async () => {
        throw NextlyError.forbidden();
      },
      {
        onError: () => {
          throw new Error("hook crashed");
        },
      }
    );
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("withErrorHandler — logger integration", () => {
  it("always logs an error line on classified failures", async () => {
    const handler = withErrorHandler(async () => {
      throw NextlyError.forbidden({ logContext: { action: "delete" } });
    });
    await handler(new Request("http://localhost/api/x"));
    expect(mockLogger.error).toHaveBeenCalledOnce();
    const payload = (mockLogger.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(payload).toMatchObject({
      kind: "route-handler-error",
      code: "FORBIDDEN",
      route: "/api/x",
    });
  });
});

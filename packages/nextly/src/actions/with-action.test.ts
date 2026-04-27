import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock next/headers BEFORE importing withAction so its module-load-time
// import resolves to the mock. The default returns an empty Headers instance.
let mockedHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => mockedHeaders,
}));

import { DbError } from "../database/errors";
import { NextlyError } from "../errors/nextly-error";
import { setNextlyLogger, type NextlyLogger } from "../observability/logger";
import { setGlobalOnError, type OnErrorHook } from "../observability/on-error";

import { withAction } from "./with-action";

let mockLogger: NextlyLogger;

beforeEach(() => {
  mockedHeaders = new Headers();
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

describe("withAction — happy path", () => {
  it("returns { ok: true, data } on success", async () => {
    const action = withAction(async (n: number) => n * 2);
    const result = await action(21);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it("supports the form-action signature (prevState, formData)", async () => {
    type Prev = ReturnType<typeof __dummyTyper>;
    function __dummyTyper(): { ok: true; data: { title: string } } | null {
      return null;
    }
    const action = withAction(
      async (
        _prev: Prev | null,
        formData: FormData
      ): Promise<{ title: string }> => {
        return { title: formData.get("title") as string };
      }
    );
    const fd = new FormData();
    fd.set("title", "hello");
    const result = await action(null, fd);
    expect(result).toEqual({ ok: true, data: { title: "hello" } });
  });
});

describe("withAction — error path", () => {
  it("returns { ok: false, error } on a thrown NextlyError", async () => {
    const action = withAction(async () => {
      throw NextlyError.forbidden();
    });
    const result = await action();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
      expect(result.error.message).toBe(
        "You don't have permission to perform this action."
      );
      expect(result.error.requestId).toMatch(/^req_[a-z2-7]{16}$/);
    }
  });

  it("includes data field on validation errors", async () => {
    const action = withAction(async () => {
      throw NextlyError.validation({
        errors: [{ path: "title", code: "REQUIRED", message: "Required." }],
      });
    });
    const result = await action();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data).toEqual({
        errors: [{ path: "title", code: "REQUIRED", message: "Required." }],
      });
    }
  });

  it("wraps unknown Error as INTERNAL_ERROR with generic message", async () => {
    const action = withAction(async () => {
      throw new TypeError("internal boom");
    });
    const result = await action();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).toBe("An unexpected error occurred.");
      expect(result.error.message).not.toContain("internal boom");
    }
  });

  it("converts a stray DbError via fromDatabaseError safety net", async () => {
    const action = withAction(async () => {
      throw new DbError({
        message: "duplicate key",
        kind: "unique-violation",
        dialect: "postgresql",
        cause: new Error("driver"),
      });
    });
    const result = await action();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DUPLICATE");
      expect(result.error.message).toBe("Resource already exists.");
    }
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("withAction — requestId", () => {
  it("honors x-request-id from headers() when set", async () => {
    mockedHeaders = new Headers({ "x-request-id": "req_upstream0000001" });
    const action = withAction(async () => {
      throw NextlyError.notFound();
    });
    const result = await action();
    if (!result.ok) {
      expect(result.error.requestId).toBe("req_upstream0000001");
    }
  });

  it("falls back to a generated id when no upstream header is set", async () => {
    const action = withAction(async () => {
      throw NextlyError.notFound();
    });
    const result = await action();
    if (!result.ok) {
      expect(result.error.requestId).toMatch(/^req_[a-z2-7]{16}$/);
    }
  });
});

describe("withAction — onError hooks", () => {
  it("calls per-call onError hook with server-action kind", async () => {
    const onError = vi.fn() satisfies OnErrorHook;
    const action = withAction(
      async () => {
        throw NextlyError.forbidden();
      },
      { onError }
    );
    await action();
    expect(onError).toHaveBeenCalledOnce();
    const [err, ctx] = onError.mock.calls[0];
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(ctx).toMatchObject({ kind: "server-action" });
    expect(ctx.requestId).toMatch(/^req_/);
  });

  it("calls global onError hook when set", async () => {
    const globalHook = vi.fn() satisfies OnErrorHook;
    setGlobalOnError(globalHook);
    const action = withAction(async () => {
      throw NextlyError.forbidden();
    });
    await action();
    expect(globalHook).toHaveBeenCalledOnce();
  });

  it("a failing onError hook does not poison the result", async () => {
    const action = withAction(
      async () => {
        throw NextlyError.forbidden();
      },
      {
        onError: () => {
          throw new Error("hook crashed");
        },
      }
    );
    const result = await action();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("withAction — Next.js sentinels", () => {
  it("re-throws Next.js redirect via unstable_rethrow", async () => {
    const redirectError = new Error("NEXT_REDIRECT") as Error & {
      digest?: string;
    };
    redirectError.digest = "NEXT_REDIRECT;replace;/login;307;";
    const action = withAction(async () => {
      throw redirectError;
    });
    await expect(action()).rejects.toBe(redirectError);
  });
});

describe("withAction — logger integration", () => {
  it("always logs an error line on classified failures", async () => {
    const action = withAction(async () => {
      throw NextlyError.forbidden({ logContext: { action: "delete" } });
    });
    await action();
    expect(mockLogger.error).toHaveBeenCalledOnce();
    const payload = (mockLogger.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(payload).toMatchObject({
      kind: "server-action-error",
      code: "FORBIDDEN",
    });
  });
});

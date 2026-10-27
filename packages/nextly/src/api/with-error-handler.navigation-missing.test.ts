// A deployment bundle traced without `next/navigation`: the `createRequire`
// call that loads it is opaque to file tracing, so on a host that bundles each
// function (Vercel) the module can be missing at run time. `node:module` is
// mocked so that require fails as it does there; the ESM import of
// `next/navigation` below is unaffected, which is what lets the tests make
// Next's real sentinels.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:module", async importOriginal => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: (from: string | URL) => {
      const real = actual.createRequire(from);
      return (id: string) => {
        if (id === "next/navigation") {
          throw Object.assign(
            new Error(
              "Cannot find module 'next/dist/server/route-modules/pages/vendored/contexts/app-router-context'"
            ),
            { code: "MODULE_NOT_FOUND" }
          );
        }
        return real(id);
      };
    },
  };
});

import { NextlyError } from "../errors/nextly-error";
import { setNextlyLogger, type NextlyLogger } from "../observability/logger";

import { withErrorHandler } from "./with-error-handler";

let mockLogger: NextlyLogger;

beforeEach(() => {
  mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  setNextlyLogger(mockLogger);
});

afterEach(() => {
  setNextlyLogger(undefined);
});

describe("withErrorHandler without next/navigation", () => {
  it("still answers a handler's error as that error", async () => {
    const handler = withErrorHandler(
      async (_req: Request): Promise<Response> => {
        throw NextlyError.validation({
          errors: [{ path: "title", code: "required", message: "Required." }],
        });
      }
    );
    const res = await handler(new Request("http://localhost/api/x"));
    expect(res.status).toBe(400);
  });

  it("still re-throws redirect() and notFound()", async () => {
    const { redirect, notFound } = await import("next/navigation");
    const redirecting = withErrorHandler(
      async (_req: Request): Promise<Response> => {
        return redirect("/login");
      }
    );
    await expect(
      redirecting(new Request("http://localhost/api/x"))
    ).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;/),
    });
    const missing = withErrorHandler(
      async (_req: Request): Promise<Response> => {
        return notFound();
      }
    );
    await expect(
      missing(new Request("http://localhost/api/x"))
    ).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_HTTP_ERROR_FALLBACK;404$/),
    });
  });

  it("re-throws a sentinel carried as another error's cause", async () => {
    const { redirect } = await import("next/navigation");
    let sentinel: unknown;
    try {
      redirect("/login");
    } catch (err) {
      sentinel = err;
    }
    const handler = withErrorHandler(
      async (_req: Request): Promise<Response> => {
        throw new Error("wrapped", { cause: sentinel });
      }
    );
    await expect(handler(new Request("http://localhost/api/x"))).rejects.toBe(
      sentinel
    );
  });
});

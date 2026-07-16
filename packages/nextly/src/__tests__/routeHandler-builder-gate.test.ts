/**
 * The builder gate at the HTTP boundary.
 *
 * `builder-access.test.ts` covers the decision; this covers the response. The
 * two are not interchangeable: the gate sits outside the dispatcher's
 * NextlyError-to-response mapping, so a refusal raised the obvious way escapes
 * as a 500 with an empty body while every unit test of the decision stays
 * green. Only a real Request through the real handler can see that, so these
 * assert the wire: status, code, and envelope.
 *
 * No database is involved — the refusal short-circuits before service dispatch,
 * which is itself part of what these lock in.
 */

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;

/**
 * Put a variable back as it was, including having been absent.
 *
 * Assigning `undefined` to `process.env` stores the string "undefined", which
 * reads as a set value to everything downstream — so an unset variable has to
 * be deleted rather than restored.
 */
function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

// Requests that get past the gate reach authentication, which validates the
// environment. sqlite is the one dialect that needs no connection string, and
// an unauthenticated request is refused before any connection is opened.
process.env.DB_DIALECT = "sqlite";

afterEach(() => {
  restoreEnv("NODE_ENV", ORIGINAL_NODE_ENV);
});

afterAll(() => {
  restoreEnv("DB_DIALECT", ORIGINAL_DB_DIALECT);
});

/** Handlers wired to a config whose builder flag is set as given. */
function handlersWith(showBuilder: boolean | undefined) {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      admin: showBuilder === undefined ? {} : { branding: { showBuilder } },
    }),
  });
}

/** Next.js hands route segments in as a promise; mirror that shape. */
function ctx(params: string[]) {
  return { params: Promise.resolve({ params }) };
}

function request(path: string, httpMethod: string, body?: unknown) {
  return new Request(`http://localhost/api/${path}`, {
    method: httpMethod,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readError(response: Response) {
  const json = (await response.json()) as { error?: { code?: string } };
  return json.error;
}

describe("builder gate over HTTP", () => {
  it("refuses a schema write with 403 and the canonical envelope", async () => {
    const handlers = handlersWith(false);
    const response = await handlers.POST(
      request("collections", "POST", { name: "posts" }),
      ctx(["collections"])
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json"
    );
    expect(await readError(response)).toMatchObject({
      code: "BUILDER_DISABLED",
      message: expect.stringContaining("showBuilder"),
    });
  });

  it("does not leak the operation into the refusal body", async () => {
    const handlers = handlersWith(false);
    const response = await handlers.POST(
      request("collections", "POST", { name: "posts" }),
      ctx(["collections"])
    );

    expect(Object.keys((await readError(response)) ?? {}).sort()).toEqual([
      "code",
      "message",
      "requestId",
    ]);
  });

  it("carries a request id on the refusal", async () => {
    const handlers = handlersWith(false);
    const response = await handlers.POST(
      request("collections", "POST", {}),
      ctx(["collections"])
    );

    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("refuses every schema-mutating verb", async () => {
    const handlers = handlersWith(false);
    const calls: Array<[Promise<Response>, string]> = [
      [
        handlers.POST(request("singles", "POST", {}), ctx(["singles"])),
        "POST /singles",
      ],
      [
        handlers.PATCH(
          request("singles/homepage/schema", "PATCH", {}),
          ctx(["singles", "homepage", "schema"])
        ),
        "PATCH /singles/homepage/schema",
      ],
      [
        handlers.DELETE(
          request("components/hero", "DELETE"),
          ctx(["components", "hero"])
        ),
        "DELETE /components/hero",
      ],
      [
        handlers.POST(
          request("collections/schema/posts/apply", "POST", {}),
          ctx(["collections", "schema", "posts", "apply"])
        ),
        "POST /collections/schema/posts/apply",
      ],
    ];

    for (const [call, label] of calls) {
      const response = await call;
      expect(response.status, label).toBe(403);
      expect((await readError(response))?.code, label).toBe("BUILDER_DISABLED");
    }
  });

  it("refuses in production when the host sets no flag", async () => {
    process.env.NODE_ENV = "production";
    const handlers = handlersWith(undefined);
    const response = await handlers.POST(
      request("collections", "POST", { name: "posts" }),
      ctx(["collections"])
    );

    expect(response.status).toBe(403);
    expect((await readError(response))?.code).toBe("BUILDER_DISABLED");
  });

  it("lets a schema write through to authentication while the builder is enabled", async () => {
    const handlers = handlersWith(true);
    const response = await handlers.POST(
      request("collections", "POST", { name: "posts" }),
      ctx(["collections"])
    );

    // Not asserted as a success: the request is unauthenticated, so the point
    // is that authentication is what answers it. A 401 means the gate opened
    // and handed the request on rather than refusing it itself.
    expect(response.status).toBe(401);
    expect((await readError(response))?.code).not.toBe("BUILDER_DISABLED");
  });

  it("leaves reads open where the builder is disabled", async () => {
    const handlers = handlersWith(false);
    const response = await handlers.GET(
      request("collections", "GET"),
      ctx(["collections"])
    );

    // A deployed site still lists its collections to manage entries, so this
    // must reach authentication rather than the builder's refusal.
    expect(response.status).not.toBe(403);
    expect((await readError(response))?.code).not.toBe("BUILDER_DISABLED");
  });

  it("leaves entry writes open where the builder is disabled", async () => {
    const handlers = handlersWith(false);
    const response = await handlers.POST(
      request("collections/posts/entries", "POST", { title: "hello" }),
      ctx(["collections", "posts", "entries"])
    );

    expect(response.status).not.toBe(403);
    expect((await readError(response))?.code).not.toBe("BUILDER_DISABLED");
  });
});

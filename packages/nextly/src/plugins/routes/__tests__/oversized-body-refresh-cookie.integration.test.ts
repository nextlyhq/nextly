/**
 * A request carrying the refresh cookie and a body past the cap is refused
 * with the validation envelope, through the real catch-all.
 *
 * The refresh cookie is stripped before a plugin route or an auth hook sees
 * the request, and stripping it copies the body, which stops at the CSRF body
 * cap and throws past it. The catch-all maps no thrown error to a response, so
 * a throw from the copy would leave the request without an answer.
 *
 * @module plugins/routes/oversized-body-refresh-cookie.integration
 */
import { afterEach, describe, expect, it } from "vitest";

import { MAX_CSRF_BODY_BYTES } from "../../../auth/csrf/read-csrf-body";
import { createDynamicHandlers } from "../../../routeHandler";
import { definePlugin } from "../../plugin-context";
import type { TestNextly } from "../../test-nextly";
import { createTestNextly } from "../../test-nextly";

const PLUGIN = "oversized-body";
const REFRESH = "nextly_refresh=refresh-token";
let handle: TestNextly | undefined;
const reached: string[] = [];

const plugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/echo",
        public: true,
        handler: async req => {
          reached.push("route");
          return Response.json({ bytes: (await req.arrayBuffer()).byteLength });
        },
      },
    ],
    auth: {
      hooks: {
        beforeLogin: () => {
          reached.push("beforeLogin");
        },
      },
    },
  },
});

function post(
  segments: string[],
  body: string,
  headers: Record<string, string>
): Promise<Response> {
  return createDynamicHandlers().POST(
    new Request(`http://localhost/admin/api/${segments.join("/")}`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({ params: segments }) }
  );
}

const oversized = (): string => "x".repeat(MAX_CSRF_BODY_BYTES + 1024);

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
  reached.length = 0;
});

describe("an oversized body beside the refresh cookie", () => {
  it("is refused at a plugin route with the validation envelope", async () => {
    handle = await createTestNextly({ plugins: [plugin] });

    const res = await post(["plugins", PLUGIN, "echo"], oversized(), {
      cookie: REFRESH,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(reached).toEqual([]);
  });

  it("reaches the plugin route under the cap", async () => {
    // The control: the route is reachable, so the refusal above is the cap
    // and not a route that never matched.
    handle = await createTestNextly({ plugins: [plugin] });

    const res = await post(["plugins", PLUGIN, "echo"], "x".repeat(1024), {
      cookie: REFRESH,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bytes: 1024 });
    expect(reached).toEqual(["route"]);
  });

  it("is answered, not thrown, on the login path an auth hook runs on", async () => {
    // Login reads its JSON body before any hook runs, so the copy the hook
    // receives has no body left to read and cannot hit the cap. What this
    // pins is that the oversized body still produces an answer there.
    handle = await createTestNextly({ plugins: [plugin] });
    const body = JSON.stringify({
      email: "nobody@example.com",
      password: "not-a-real-password",
      padding: oversized(),
    });

    const res = await post(["auth", "login"], body, {
      cookie: `${REFRESH}; nextly_csrf=csrf-token`,
      "content-type": "application/json",
      "x-csrf-token": "csrf-token",
      origin: "http://localhost",
    });

    expect(res.status).toBeLessThan(500);
    expect(await res.json()).toMatchObject({
      error: { code: expect.any(String) },
    });
    expect(reached).toEqual(["beforeLogin"]);
  });
});

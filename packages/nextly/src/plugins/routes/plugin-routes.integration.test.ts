/**
 * End-to-end secure-by-default proof for plugin routes (D28), driven through the
 * REAL catch-all dispatcher (`createDynamicHandlers`) with REAL JWT auth.
 *
 * Coverage split (documented): auth is stateless JWT verification, so a signed
 * `nextly_session` cookie exercises the real auth path here — proving routes are
 * closed by default (401), `public` opts out (200), and `requiredPermission`
 * blocks the unprivileged (403). The `requiredPermission`-GRANTED path is DB-RBAC
 * backed (`isSuperAdmin`/`hasPermission` resolve by userId from the DB) and the
 * harness does not seed a privileged user, so that positive branch is covered by
 * the unit test `dispatch-auth.test.ts` (requirePermission → AuthContext → handler).
 */

// Must be set before the harness boots (env validation) and to sign test tokens.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { createDynamicHandlers } from "../../routeHandler";
import { definePlugin } from "../plugin-context";
import type { TestNextly } from "../test-nextly";
import { createTestNextly } from "../test-nextly";

const PLUGIN = "@test/routes-e2e";

const e2ePlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/open",
        public: true,
        handler: () => Response.json({ ok: true }),
      },
      {
        method: "GET",
        path: "/whoami",
        handler: (_req, ctx) => Response.json({ id: ctx.user?.id ?? null }),
      },
      {
        method: "GET",
        path: "/privileged",
        requiredPermission: "manage-things",
        handler: () => Response.json({ secret: true }),
      },
    ],
  },
});

async function cookie(roleIds: string[] = []): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId: "u1",
      email: "u1@example.com",
      name: "U1",
      image: null,
      roleIds,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

/** Call the real catch-all for GET /api/plugins/<PLUGIN>/<sub>. */
function get(
  sub: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const url = `http://localhost/api/plugins/${PLUGIN}/${sub}`;
  const params = ["plugins", ...PLUGIN.split("/"), sub];
  return handlers.GET(new Request(url, { headers }), {
    params: Promise.resolve({ params }),
  });
}

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

describe("plugin routes — secure by default (D28, end-to-end)", () => {
  it("a public route is reachable without auth", async () => {
    handle = await createTestNextly({ plugins: [e2ePlugin] });
    const res = await get("open");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("a non-public route returns 401 without a session", async () => {
    handle = await createTestNextly({ plugins: [e2ePlugin] });
    expect((await get("whoami")).status).toBe(401);
  });

  it("a non-public route runs with the authed user when a session is present", async () => {
    handle = await createTestNextly({ plugins: [e2ePlugin] });
    const res = await get("whoami", { cookie: await cookie() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u1" });
  });

  it("a requiredPermission route returns 403 for a user lacking the permission", async () => {
    handle = await createTestNextly({ plugins: [e2ePlugin] });
    expect((await get("privileged", { cookie: await cookie() })).status).toBe(
      403
    );
  });
});

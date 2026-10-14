/**
 * A plugin-defined signed-in person reaches nothing of staff, on every
 * configured dialect.
 *
 * Each staff entry point is driven with a request carrying only the person's
 * own session cookie, one the plugin's resolver accepts, and must answer as it
 * answers an anonymous caller. In the same test, the plugin's own route that
 * asks for the kind accepts that same cookie: the control that shows the
 * session is a real one and the refusals are about where it was presented.
 * The resolver records its calls, and no staff entry point makes one.
 *
 * "Never the admin" is the absence of a path, so these tests are what keep
 * the path absent: each is watched failing against a build in which its
 * entry point consults the resolver.
 *
 * @module plugins/principals/__tests__/no-staff-entry-point.integration.test
 */

// Read by the session reader, the API-key check and the login handler, and
// validated when the harness boots: set before any of them is imported.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAuthRouterDeps } from "../../../auth/handlers/deps-bridge";
import { handleLogin } from "../../../auth/handlers/login";
import type { AuthStrategy } from "../../../auth/pipeline/types";
import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import { getDialectTables } from "../../../database/index";
import { seedPermissions } from "../../../database/seeders/permissions";
import { seedSuperAdmin } from "../../../database/seeders/super-admin";
import { createDynamicHandlers } from "../../../routeHandler";
import type { PluginDefinition } from "../../plugin-context";
import type { PluginRouteContext } from "../../routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../test-nextly";
import type { Principal } from "../types";

const KIND = "accounts:account";
const ORIGIN = "http://localhost";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The plugin's own session: any id the cookie names is a signed-in member. */
const resolve = vi.fn(async (request: Request) => {
  const match = /acc_session=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return match ? { id: match[1], attributes: { verified: true } } : null;
});

/** What the staff session hook saw, each time it ran. */
const determineUser = vi.fn(async () => undefined);

const accounts = {
  name: "accounts",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean" },
        resolve,
        lookup: async (id: string) => ({ id, attributes: { verified: true } }),
      },
    ],
    auth: { hooks: { determineUser } },
    routes: [
      // The control: the plugin's own route, asking for the kind.
      {
        method: "GET",
        path: "/me",
        principal: { kind: KIND },
        handler: (_req: Request, ctx: PluginRouteContext) =>
          Response.json({ id: ctx.principal?.id ?? null }),
      },
      // A route asking for no kind and naming no permission.
      {
        method: "GET",
        path: "/staff",
        handler: (_req: Request, ctx: PluginRouteContext) =>
          Response.json({ id: ctx.user?.id ?? null }),
      },
      // A public route whose handler asks for the staff user.
      {
        method: "GET",
        path: "/who",
        public: true,
        handler: async (req: Request, ctx: PluginRouteContext) =>
          Response.json({ user: await ctx.auth.currentUser(req) }),
      },
    ],
  },
} as unknown as PluginDefinition;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [accounts],
    collections: [
      // No rule at all: staff with a grant, and a super-admin, read it.
      defineCollection({ slug: "notes", fields: [text({ name: "title" })] }),
      // A rule a staff user passes and a person fails, beside a field rule
      // only staff passes.
      defineCollection({
        slug: "staff_notes",
        access: { read: ({ user }) => !!user },
        fields: [
          text({ name: "title" }),
          text({
            name: "internal",
            access: {
              read: ({ principal }: { principal: Principal | null }) =>
                principal === null,
            },
          } as never),
        ],
      }),
    ],
  });
  resolve.mockClear();
  determineUser.mockClear();
  return current;
}

/** A request through the real catch-all, addressed by its path segments. */
function call(
  method: "GET" | "POST",
  segments: string[],
  init: { cookie?: string; body?: unknown; headers?: Record<string, string> }
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const headers: Record<string, string> = {
    origin: ORIGIN,
    ...(init.cookie ? { cookie: init.cookie } : {}),
    ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    ...init.headers,
  };
  const request = new Request(`${ORIGIN}/api/${segments.join("/")}`, {
    method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const context = { params: Promise.resolve({ params: segments }) };
  return method === "GET"
    ? handlers.GET(request, context)
    : handlers.POST(request, context);
}

/** Every staff session cookie a response sets. */
function staffCookiesSet(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter(c => /^nextly_(session|refresh)=[^;]/.test(c));
}

/** The control: the plugin's own asking route accepts the person. */
async function expectPersonAcceptedByOwnRoute(cookie: string, id: string) {
  const res = await call("GET", ["plugins", "accounts", "me"], { cookie });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id });
}

const PERSON = "acc_session=m1";

describe.each(getConfiguredTestDialects())(
  "a plugin-defined person at staff entry points (%s)",
  dialect => {
    it("is not signed in to the admin's sign-in, and gets no staff session", async () => {
      await boot(dialect);
      const res = await call("POST", ["auth", "login"], {
        cookie: `${PERSON}; nextly_csrf=tok`,
        headers: { "x-csrf-token": "tok" },
        body: { csrfToken: "tok" },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(staffCookiesSet(res)).toEqual([]);
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it("is not signed in through a strategy in auth.strategies", async () => {
      const t = await boot(dialect);
      const seen: Request[] = [];
      const recording: AuthStrategy = {
        name: "recording",
        authenticate: async ({ request }) => {
          seen.push(request);
          return { type: "pass" };
        },
      };
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      deps.authStrategies = [recording, ...deps.authStrategies];
      const res = await handleLogin(
        new Request(`${ORIGIN}/admin/api/auth/login`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            cookie: `${PERSON}; nextly_csrf=tok`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ csrfToken: "tok" }),
        }),
        deps
      );
      // The strategy ran, saw the person's cookie, and core made nothing of
      // it: no person was handed to it and no session came back.
      expect(seen).toHaveLength(1);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(staffCookiesSet(res)).toEqual([]);
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it("is not signed in to core's session endpoint, and determineUser is told nothing of them", async () => {
      await boot(dialect);
      const res = await call("GET", ["auth", "session"], { cookie: PERSON });
      expect(res.status).toBe(401);
      expect(staffCookiesSet(res)).toEqual([]);
      // The staff hook ran, as it does for every session read, and the only
      // thing it was given was the request; core resolved no one for it.
      expect(determineUser).toHaveBeenCalledTimes(1);
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it("is not signed in to the admin's screens", async () => {
      await boot(dialect);
      // The admin shell's server read: the workspace it renders from.
      const res = await call("GET", ["admin-meta", "workspace"], {
        cookie: PERSON,
      });
      expect(res.status).toBe(401);
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it.each([
      ["the current user", ["me"]],
      ["the current user's permissions", ["me", "permissions"]],
      ["a collection's entries", ["collections", "notes", "entries"]],
    ])("is not signed in to core's REST endpoint for %s", async (_l, path) => {
      await boot(dialect);
      const res = await call("GET", path, { cookie: PERSON });
      expect(res.status).toBe(401);
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it("is not signed in to a plugin route that asks for no kind", async () => {
      await boot(dialect);
      const res = await call("GET", ["plugins", "accounts", "staff"], {
        cookie: PERSON,
      });
      expect(res.status).toBe(401);
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it("is no user to ctx.auth.currentUser", async () => {
      await boot(dialect);
      const res = await call("GET", ["plugins", "accounts", "who"], {
        cookie: PERSON,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: null });
      expect(resolve).not.toHaveBeenCalled();
      await expectPersonAcceptedByOwnRoute(PERSON, "m1");
    });

    it("gets nothing of a super-admin whose id it shares", async () => {
      const t = await boot(dialect);
      await seedPermissions(t.adapter, { silent: true });
      const seeded = await seedSuperAdmin(t.adapter, {
        email: "owner@example.com",
        password: "Str0ng-P@ssw0rd!",
        name: "Owner",
        silent: true,
      });
      expect(seeded.success).toBe(true);
      const users = await t.adapter.select<{ id: string; email: string }>(
        "users",
        {}
      );
      const adminId = String(
        users.find(u => u.email === "owner@example.com")?.id
      );
      await t.nextly.create({
        collection: "staff_notes",
        data: { title: "t", internal: "secret" },
      });
      await t.nextly.create({ collection: "notes", data: { title: "n" } });

      // The super-admin reads both collections, every field.
      const staffRead = await t.nextly.find({
        collection: "staff_notes",
        user: { id: adminId },
        overrideAccess: false,
      });
      expect(staffRead.items[0]).toMatchObject({ internal: "secret" });

      // A person with the same id: a person, not the super-admin.
      const twin = await t.nextly.principals.byId(KIND, adminId);
      expect(twin?.id).toBe(adminId);
      await expect(
        t.nextly.find({ collection: "notes", principal: twin! })
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        t.nextly.find({ collection: "staff_notes", principal: twin! })
      ).rejects.toMatchObject({ statusCode: 403 });

      // On the wire: the twin's cookie reaches the staff route as nobody,
      // while its own route sees it as the person it is.
      const cookie = `acc_session=${adminId}`;
      const staffRoute = await call("GET", ["plugins", "accounts", "staff"], {
        cookie,
      });
      expect(staffRoute.status).toBe(401);
      await expectPersonAcceptedByOwnRoute(cookie, adminId);
    });

    it("never has its id stored in a staff session", async () => {
      const t = await boot(dialect);
      const { refreshTokens } = getDialectTables();
      const refreshRows = () =>
        (
          t.adapter as unknown as {
            getDrizzle(): {
              select(): {
                from(table: unknown): Promise<{ userId: string }[]>;
              };
            };
          }
        )
          .getDrizzle()
          .select()
          .from(refreshTokens);

      // The control: a real staff sign-in sets the staff cookies and writes a
      // refresh row naming the staff user, so the reads below can see a
      // session when there is one.
      await seedPermissions(t.adapter, { silent: true });
      await seedSuperAdmin(t.adapter, {
        email: "owner@example.com",
        password: "Str0ng-P@ssw0rd!",
        name: "Owner",
        silent: true,
      });
      const staffLogin = await call("POST", ["auth", "login"], {
        cookie: "nextly_csrf=tok",
        headers: { "x-csrf-token": "tok" },
        body: {
          csrfToken: "tok",
          email: "owner@example.com",
          password: "Str0ng-P@ssw0rd!",
        },
      });
      expect(staffLogin.status).toBe(200);
      expect(staffCookiesSet(staffLogin).length).toBeGreaterThan(0);
      const before = await refreshRows();
      expect(before).toHaveLength(1);

      const responses = [
        await call("POST", ["auth", "login"], {
          cookie: `${PERSON}; nextly_csrf=tok`,
          headers: { "x-csrf-token": "tok" },
          body: { csrfToken: "tok" },
        }),
        await call("GET", ["auth", "session"], { cookie: PERSON }),
        await call("GET", ["plugins", "accounts", "me"], { cookie: PERSON }),
        await call("GET", ["plugins", "accounts", "who"], { cookie: PERSON }),
      ];
      for (const res of responses) expect(staffCookiesSet(res)).toEqual([]);
      const after = await refreshRows();
      expect(after.map(row => row.userId)).toEqual(
        before.map(row => row.userId)
      );
      expect(after.map(row => row.userId)).not.toContain("m1");
    });
  }
);

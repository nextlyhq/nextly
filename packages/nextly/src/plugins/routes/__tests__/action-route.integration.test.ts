/**
 * A plugin route a declared action runs is reachable only as that action, on
 * every configured dialect: a direct request is judged on the action's own
 * permission and on its rule against each row it names, read as the caller,
 * before the handler runs, and refused otherwise with nothing run. A route no
 * action runs is untouched, and a plugin list rewritten after boot does not
 * unbind a route.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, text } from "../../../config";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
import { setHandlerConfig } from "../../../route-handler/auth-handler";
import { sanitizeConfig } from "../../../shared/types/config";
import type { AdminContribution } from "../../admin-contributions";
import type { PluginDefinition } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../test-nextly";
import { MAX_ACTION_ROWS } from "../action-route-check";
import { runPluginRoute } from "../dispatch";
import { getPluginRouteRegistry } from "../route-registry";

const TICKETS = "art_tickets";
const AGENT = "user-art-agent";
const BOSS = "user-art-boss";

/** What each handler was asked, so "nothing ran" can be seen. */
const ran: Array<{ path: string; body: unknown }> = [];
const handler = (path: string) => async (req: Request) => {
  ran.push({ path, body: await req.json().catch(() => undefined) });
  return Response.json({ ok: true });
};

const route = (path: string) => ({
  siteWide: false as const,
  method: "POST" as const,
  path,
  handler: handler(path),
});

const SUPPORT: PluginDefinition = {
  name: "@acme/support",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    routes: [
      route("/escalate"),
      route("/purge"),
      route("/assign"),
      route("/coded"),
      route("/free"),
    ],
    admin: {
      contributions: [
        {
          id: "acme-support.escalate",
          kind: "rowAction",
          place: "collection.list",
          collections: [TICKETS],
          label: "Escalate",
          action: { run: { method: "POST", path: "/escalate" } },
          requiredPermission: `update-${TICKETS}`,
          visibleWhen: { field: "status", notEquals: "closed" },
        },
        {
          id: "acme-support.purge",
          kind: "rowAction",
          place: "collection.list",
          label: "Purge",
          action: { run: { method: "POST", path: "/purge" } },
          requiredPermission: `delete-${TICKETS}`,
        },
        {
          id: "acme-support.assign",
          kind: "bulkAction",
          place: "collection.list",
          label: "Assign",
          action: { run: { method: "POST", path: "/assign" } },
          visibleWhen: { field: "status", equals: "open" },
        },
        {
          id: "acme-support.coded",
          kind: "rowAction",
          place: "collection.list",
          label: "Coded",
          action: { run: { method: "POST", path: "/coded" } },
          visibleWhen: { field: "codename", exists: true },
        },
      ] as AdminContribution[],
    },
  },
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ran.length = 0;
});

/** The ids of the seeded tickets, by title. */
let ids: Record<string, string> = {};

async function boot(dialect: TestDialect): Promise<void> {
  current = await createTestNextly({
    dialect,
    plugins: [SUPPORT],
    collections: [
      defineCollection({
        slug: TICKETS,
        // Each caller reads only the tickets they own.
        access: {
          read: ({ user }: { user?: { id?: string } }) => ({
            owner: { equals: user?.id ?? "" },
          }),
        },
        fields: [
          text({ name: "title" }),
          text({ name: "status" }),
          text({ name: "owner" }),
          text({
            name: "codename",
            access: {
              read: ({ req }: { req: { user?: { id?: unknown } } }) =>
                req.user?.id === BOSS,
            },
          } as never),
        ],
      } as never),
    ],
  });
  expect(current.adapter.dialect).toBe(dialect);
  await userWhoMay(current, AGENT, "read", [TICKETS]);
  await grantTo(current, AGENT, "update", [TICKETS]);
  await userWhoMay(current, BOSS, "read", [TICKETS]);
  ids = {};
  for (const [title, status, owner] of [
    ["mine open", "open", AGENT],
    ["mine closed", "closed", AGENT],
    ["boss open", "open", BOSS],
    // Readable to its owner, and withheld from any read made for a request by
    // the request-scoped hook one test registers.
    ["mine withheld", "withheld", AGENT],
  ]) {
    const created = await current.nextly.create({
      collection: TICKETS as never,
      data: { title, status, owner, codename: "c" } as never,
      overrideAccess: true,
    } as never);
    ids[title] = String(created.item.id);
  }
}

async function cookieFor(userId: string): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

/** POST `body` to the plugin's route at `path` as `userId`, through the dispatcher. */
async function post(
  path: string,
  body: unknown,
  userId = AGENT
): Promise<{ status: number; code?: string }> {
  const fullPath = `/plugins/@acme/support${path}`;
  const match = getPluginRouteRegistry().match("POST", fullPath, "plugin");
  expect(match).not.toBeNull();
  const res = await runPluginRoute(
    new Request(`http://localhost/api${fullPath}`, {
      method: "POST",
      headers: {
        cookie: await cookieFor(userId),
        "content-type": "application/json",
        // Same-origin, as a browser sends it, so the cookie write passes the
        // route's own origin check and reaches the check under test.
        origin: "http://localhost",
      },
      body: JSON.stringify(body),
    }),
    match!
  );
  const json = (await res.json().catch(() => ({}))) as {
    error?: { code?: string };
  };
  return { status: res.status, code: json.error?.code };
}

const one = (title: string) => [{ collection: TICKETS, id: ids[title] }];

describe.each(getConfiguredTestDialects())(
  "a route a declared action runs (%s)",
  dialect => {
    it("runs the handler once for a request the action allows, with its body whole", async () => {
      await boot(dialect);
      const body = {
        action: "acme-support.escalate",
        rows: one("mine open"),
        note: "kept",
      };
      expect(await post("/escalate", body)).toEqual({
        status: 200,
        code: undefined,
      });
      expect(ran).toEqual([{ path: "/escalate", body }]);
    });

    it("refuses a caller without the action's permission, with nothing run", async () => {
      await boot(dialect);
      expect(
        await post("/purge", {
          action: "acme-support.purge",
          rows: one("mine open"),
        })
      ).toMatchObject({ status: 403, code: "FORBIDDEN" });
      expect(ran).toEqual([]);
    });

    it("refuses a readable row the rule hides, saying only that the action is not available", async () => {
      await boot(dialect);
      expect(
        await post("/escalate", {
          action: "acme-support.escalate",
          rows: one("mine closed"),
        })
      ).toEqual({ status: 403, code: "ACTION_NOT_AVAILABLE" });
      expect(ran).toEqual([]);
    });

    it("answers a row the caller may not read as a missing one, 404", async () => {
      await boot(dialect);
      for (const rows of [
        one("boss open"),
        [{ collection: TICKETS, id: "no-such-ticket" }],
      ]) {
        expect(
          await post("/escalate", { action: "acme-support.escalate", rows })
        ).toMatchObject({ status: 404, code: "NOT_FOUND" });
      }
      expect(ran).toEqual([]);
    });

    it("fails closed on a rule naming a field the caller may not read, and lets through the caller who may", async () => {
      await boot(dialect);
      expect(
        await post("/coded", {
          action: "acme-support.coded",
          rows: one("mine open"),
        })
      ).toEqual({ status: 403, code: "ACTION_NOT_AVAILABLE" });
      expect(ran).toEqual([]);
      expect(
        await post(
          "/coded",
          { action: "acme-support.coded", rows: one("boss open") },
          BOSS
        )
      ).toEqual({ status: 200, code: undefined });
      expect(ran).toHaveLength(1);
    });

    it("refuses a bulk request whole when one row fails, and runs it when every row passes", async () => {
      await boot(dialect);
      expect(
        await post("/assign", {
          action: "acme-support.assign",
          rows: [...one("mine open"), ...one("mine closed")],
        })
      ).toEqual({ status: 403, code: "ACTION_NOT_AVAILABLE" });
      expect(ran).toEqual([]);
      expect(
        await post("/assign", {
          action: "acme-support.assign",
          rows: one("mine open"),
        })
      ).toEqual({ status: 200, code: undefined });
      expect(ran).toHaveLength(1);
    });

    it.each<[string, unknown]>([
      [
        "a request naming no action",
        { rows: [{ collection: TICKETS, id: "x" }] },
      ],
      [
        "an action this route is not bound to",
        {
          action: "acme-support.purge",
          rows: [{ collection: TICKETS, id: "x" }],
        },
      ],
      ["no rows", { action: "acme-support.assign", rows: [] }],
      [
        "more rows than one request may name",
        {
          action: "acme-support.assign",
          rows: Array.from({ length: MAX_ACTION_ROWS + 1 }, (_, i) => ({
            collection: TICKETS,
            id: `r${i}`,
          })),
        },
      ],
      ["a body that is not JSON's object", "assign everything"],
    ])("answers 400 to %s, with nothing run", async (_case, body) => {
      await boot(dialect);
      expect(await post("/assign", body)).toMatchObject({ status: 400 });
      expect(ran).toEqual([]);
    });

    it("reads the rows for the request, so a request-scoped read hook still narrows them", async () => {
      await boot(dialect);
      // A rule that narrows reads made for a request, and stands down for
      // background work, as request-scoped rules do.
      const scope: HookHandler = ctx =>
        ctx.req?.http
          ? {
              ...(ctx.data as Record<string, unknown>),
              status: { not_equals: "withheld" },
            }
          : ctx.data;
      registerHook("beforeRead", TICKETS, scope);
      try {
        expect(
          await post("/escalate", {
            action: "acme-support.escalate",
            rows: one("mine withheld"),
          })
        ).toMatchObject({ status: 404, code: "NOT_FOUND" });
        expect(ran).toEqual([]);
      } finally {
        unregisterHook("beforeRead", TICKETS, scope);
      }
    });

    it("answers a row read that fails as its own failure, with nothing run", async () => {
      await boot(dialect);
      const handler = current!.getService("collectionsHandler") as unknown as {
        listEntries: (...args: unknown[]) => Promise<unknown>;
      };
      // A busy database keeps its code and status, so a client can retry.
      const busy = vi.spyOn(handler, "listEntries").mockResolvedValueOnce({
        success: false,
        statusCode: 503,
        code: "DATABASE_BUSY",
        message: "The database is busy.",
      });
      try {
        expect(
          await post("/escalate", {
            action: "acme-support.escalate",
            rows: one("mine open"),
          })
        ).toMatchObject({ status: 503, code: "DATABASE_BUSY" });
      } finally {
        busy.mockRestore();
      }
      // A read that throws is answered as the handler's failures are, not
      // left to escape the dispatcher.
      const broken = vi
        .spyOn(handler, "listEntries")
        .mockRejectedValueOnce(new Error("adapter: connection reset"));
      try {
        expect(
          await post("/escalate", {
            action: "acme-support.escalate",
            rows: one("mine open"),
          })
        ).toMatchObject({ status: 500 });
      } finally {
        broken.mockRestore();
      }
      expect(ran).toEqual([]);
    });

    it("leaves a route no action runs as it was", async () => {
      await boot(dialect);
      expect(await post("/free", { anything: true })).toEqual({
        status: 200,
        code: undefined,
      });
      expect(ran).toEqual([{ path: "/free", body: { anything: true } }]);
    });

    it("keeps a route bound when the configured plugin list is rewritten after boot", async () => {
      await boot(dialect);
      // As a setup transformer would leave it: the configured list no longer
      // holds the plugin's actions. The route was bound when it registered.
      setHandlerConfig(
        sanitizeConfig({
          collections: [],
          plugins: [
            {
              ...SUPPORT,
              contributes: { routes: SUPPORT.contributes!.routes },
            },
          ],
        })
      );
      expect(await post("/escalate", { anything: true })).toMatchObject({
        status: 400,
      });
      expect(ran).toEqual([]);
    });
  }
);

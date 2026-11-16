/**
 * Plugins' contributions reach a signed-in admin only, each reader receiving
 * what they may see: the workspace metadata carries every place but the login
 * page's, less a contribution behind a permission the reader lacks, and less
 * a rule or a filter option that names a field the reader may not read; the
 * public metadata carries the login page's alone, and asks no session.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { createDynamicHandlers } from "../../routeHandler";
import { sanitizeConfig } from "../../shared/types/config";
import type { AdminContribution } from "../admin-contributions";
import type { PluginDefinition } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const TICKETS = "acd_tickets";
const BOSS = "user-acd-boss";
const AGENT = "user-acd-agent";
/** Signed in, and may not read the tickets collection at all. */
const OUTSIDER = "user-acd-outsider";

const SUPPORT: PluginDefinition = {
  name: "@acme/support",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    admin: {
      filters: [
        {
          name: "acme-support.state",
          label: "State",
          collections: [TICKETS],
          options: [
            {
              value: "open",
              label: "Open",
              where: { state: { equals: "open" } },
            },
            {
              value: "coded",
              label: "Coded",
              where: { codename: { exists: true } },
            },
          ],
        },
      ],
      contributions: [
        {
          id: "acme-support.totals",
          kind: "block",
          place: "dashboard",
          component: "x#Totals",
        },
        {
          id: "acme-support.audit",
          kind: "block",
          place: "dashboard",
          component: "x#Audit",
          requiredPermission: `update-${TICKETS}`,
        },
        {
          id: "acme-support.escalate",
          kind: "rowAction",
          place: "collection.list",
          collections: [TICKETS],
          label: "Escalate",
          action: { open: "x#Escalate" },
          visibleWhen: { field: "codename", exists: true },
        },
        {
          id: "acme-support.hello",
          kind: "block",
          place: "login",
          component: "x#Hello",
        },
      ] as AdminContribution[],
    },
  },
};

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<void> {
  current = await createTestNextly({
    dialect,
    plugins: [SUPPORT],
    collections: [
      defineCollection({
        slug: TICKETS,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "state" }),
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
  for (const id of [BOSS, AGENT])
    await userWhoMay(current, id, "read", [TICKETS]);
  await grantTo(current, BOSS, "update", [TICKETS]);
  await userWhoMay(current, OUTSIDER, "read", ["media"]);
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

/** What the admin-meta route at `path` answers, for an optional session. */
async function meta(
  path: string[],
  userId?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  // The route reads the plugin list from the config it was given, overlaid
  // with what boot produced.
  const handlers = createDynamicHandlers({
    config: sanitizeConfig({ collections: [], plugins: [SUPPORT] }),
  });
  const res = await handlers.GET(
    new Request(`http://localhost/api/${path.join("/")}`, {
      headers: userId ? { cookie: await cookieFor(userId) } : {},
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

const WORKSPACE = ["admin-meta", "workspace"];
const PUBLIC = ["admin-meta"];

/** The ids a payload's contributions carry, every place and kind. */
function ids(payload: unknown): string[] {
  return [
    ...JSON.stringify(payload).matchAll(/"id":"(acme-support\.[a-z-]+)"/g),
  ]
    .map(m => m[1])
    .sort();
}

/** The workspace payload's own record, wherever the envelope keeps it. */
function workspaceOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body.data ?? body) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "plugins' contributions in the admin metadata (%s)",
  dialect => {
    it("sends a reader who may see everything every place's but the login page's", async () => {
      await boot(dialect);
      const { status, body } = await meta(WORKSPACE, BOSS);
      expect(status).toBe(200);
      const workspace = workspaceOf(body);
      expect(ids(workspace.contributions)).toEqual([
        "acme-support.audit",
        "acme-support.escalate",
        "acme-support.totals",
      ]);
      const plugin = (workspace.plugins as Array<Record<string, unknown>>).find(
        p => p.name === "@acme/support"
      );
      expect(plugin?.listFilters).toEqual([
        expect.objectContaining({
          collections: [TICKETS],
          options: [
            expect.objectContaining({ value: "open" }),
            expect.objectContaining({ value: "coded" }),
          ],
        }),
      ]);
    });

    it("leaves out for another reader what needs a permission they lack or names a field they may not read", async () => {
      await boot(dialect);
      const { status, body } = await meta(WORKSPACE, AGENT);
      expect(status).toBe(200);
      const workspace = workspaceOf(body);
      const sent = JSON.stringify(workspace);
      expect(ids(workspace.contributions)).toEqual(["acme-support.totals"]);
      // Not hidden in the browser: never sent.
      expect(sent).not.toContain("x#Audit");
      expect(sent).not.toContain("x#Escalate");
      const plugin = (workspace.plugins as Array<Record<string, unknown>>).find(
        p => p.name === "@acme/support"
      );
      expect(plugin?.listFilters).toEqual([
        expect.objectContaining({
          options: [expect.objectContaining({ value: "open" })],
        }),
      ]);
    });

    it("offers nothing on a collection the reader may not read", async () => {
      await boot(dialect);
      const { status, body } = await meta(WORKSPACE, OUTSIDER);
      expect(status).toBe(200);
      const workspace = workspaceOf(body);
      expect(ids(workspace.contributions)).toEqual(["acme-support.totals"]);
      const plugin = (workspace.plugins as Array<Record<string, unknown>>).find(
        p => p.name === "@acme/support"
      );
      expect(plugin?.listFilters).toBeUndefined();
    });

    it("refuses the workspace metadata without a session", async () => {
      await boot(dialect);
      expect((await meta(WORKSPACE)).status).toBe(401);
    });

    it("sends the public metadata the login page's contributions and no other", async () => {
      await boot(dialect);
      const { status, body } = await meta(PUBLIC);
      expect(status).toBe(200);
      expect(ids(body)).toEqual(["acme-support.hello"]);
      expect(JSON.stringify(body)).not.toContain("x#Totals");
    });
  }
);

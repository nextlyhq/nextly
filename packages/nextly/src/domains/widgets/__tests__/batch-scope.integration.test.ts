/**
 * Work shared within a widget batch stays inside it: per batch, per caller, per
 * source, through the real endpoint and the real plugin boot.
 *
 * The scope is the one place two callers' reads could meet, so its isolation is
 * an access property, not a performance detail.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import type { PluginContext } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import type { WidgetQuery } from "../query";
import type { ResolverOptions } from "../resolved-sources";
import { clearSources } from "../sources";

const NOTES = "notes";

interface Slot {
  ok: boolean;
  error?: string;
  result?: { op: string; total?: number };
}

/** How many times each source's resolvers ran, so "per query" is observed, not assumed. */
const calls = { plain: 0 };

/** A source whose answer is whatever its scope computes for `key`, after a pause so batches overlap. */
function scopedSource(
  id: string,
  key: string,
  value: (caller: ReadCaller) => number
) {
  return {
    source: {
      id,
      label: id,
      kind: "plugin",
      supports: ["count"],
      fields: [{ name: "total", type: "number" }],
    },
    resolve: async (
      _query: WidgetQuery,
      caller: ReadCaller,
      _ctx: PluginContext,
      opts?: ResolverOptions
    ) => {
      const compute = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return value(caller);
      };
      const total = opts?.scope
        ? await opts.scope.getOrCompute(key, compute)
        : await compute();
      return { op: "count" as const, total };
    },
  };
}

/** How many grants the caller's key holds: a value that differs between the two callers. */
const grantsHeld = (caller: ReadCaller) =>
  caller.authenticatedScope?.permissions.length ?? -1;

const plugins = [
  {
    name: "@acme/one",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      widgetSources: [
        scopedSource("plugin:acme/who", "who", grantsHeld),
        scopedSource("plugin:acme/a", "rows", () => 1),
        scopedSource("plugin:acme/b", "rows", () => 2),
        {
          source: {
            id: "plugin:acme/plain",
            label: "Plain",
            kind: "plugin",
            supports: ["count"],
            fields: [{ name: "total", type: "number" }],
          },
          resolve: async () => {
            calls.plain += 1;
            return { op: "count" as const, total: 7 };
          },
        },
      ],
    },
  },
  {
    name: "@other/two",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      widgetSources: [scopedSource("plugin:other/c", "rows", () => 3)],
    },
  },
];

let handle: TestNextly | undefined;
let ownerId: string | undefined;

beforeEach(async () => {
  calls.plain = 0;
  handle = await createTestNextly({
    collections: [
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
    plugins: plugins as never,
  });
});

afterEach(async () => {
  clearSources();
  await handle?.destroy();
  handle = undefined;
  ownerId = undefined;
});

/** A key holding exactly the grants named, minted by the first (super-admin) user. */
async function keyHolding(slugs: string[]): Promise<string> {
  const nextly = handle!.nextly as unknown as {
    users: {
      create: (a: {
        data: Record<string, unknown>;
      }) => Promise<{ item: { id: string } }>;
    };
    permissions: {
      find: (a: {
        limit: number;
      }) => Promise<{ items: { id: string; slug: string }[] }>;
    };
    roles: {
      create: (a: {
        data: Record<string, unknown>;
      }) => Promise<{ item: { id: string } }>;
    };
  };
  if (ownerId === undefined) {
    const owner = await nextly.users.create({
      data: {
        email: "owner@example.com",
        password: "Password123!",
        name: "Owner",
        isActive: true,
      },
    });
    ownerId = owner.item.id;
  }
  const permissions = await nextly.permissions.find({ limit: 300 });
  const ids = slugs.map(slug => {
    const found = permissions.items.find(p => p.slug === slug);
    expect(found, `\`${slug}\` must be seeded`).toBeDefined();
    return found!.id;
  });
  const role = await nextly.roles.create({
    data: {
      name: `Role ${slugs.join(" ")}`,
      slug: `r-${slugs.join("-")}`,
      permissionIds: ids,
    },
  });
  const apiKeys = handle!.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId?: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(ownerId, {
    name: `key ${slugs.join(" ")}`,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

async function query(key: string, queries: unknown[]): Promise<Slot[]> {
  const handlers = createDynamicHandlers();
  const res = await handlers.POST(
    new Request("http://localhost/api/dashboard/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ queries }),
    }),
    { params: Promise.resolve({ params: ["dashboard", "query"] }) }
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: Slot[] }).results;
}

const count = (source: string) => ({ source, op: "count" });

describe("work shared within a batch", () => {
  it("never reaches another caller: two people's batches at once each get their own", async () => {
    const one = await keyHolding([`read-${NOTES}`]);
    const two = await keyHolding([`read-${NOTES}`, `create-${NOTES}`]);

    // In flight together, each asking twice so its own scope is used.
    const [first, second] = await Promise.all([
      query(one, [count("plugin:acme/who"), count("plugin:acme/who")]),
      query(two, [count("plugin:acme/who"), count("plugin:acme/who")]),
    ]);

    const firstTotals = first.map(slot => slot.result?.total);
    const secondTotals = second.map(slot => slot.result?.total);
    expect(firstTotals[0]).toBe(firstTotals[1]);
    expect(secondTotals[0]).toBe(secondTotals[1]);
    // The two callers hold different grants, so a value that crossed would show here.
    expect(firstTotals[0]).not.toBe(secondTotals[0]);
  });

  it("never reaches another source: the same key chosen by two sources of one plugin and by another plugin", async () => {
    const key = await keyHolding([`read-${NOTES}`]);

    const slots = await query(key, [
      count("plugin:acme/a"),
      count("plugin:acme/b"),
      count("plugin:other/c"),
    ]);

    expect(slots.map(slot => slot.result?.total)).toEqual([1, 2, 3]);
  });

  it("answers a source in today's shape once per query", async () => {
    const key = await keyHolding([`read-${NOTES}`]);

    const slots = await query(key, [
      count("plugin:acme/plain"),
      count("plugin:acme/plain"),
    ]);

    expect(slots.every(slot => slot.ok)).toBe(true);
    expect(calls.plain).toBe(2);
  });
});

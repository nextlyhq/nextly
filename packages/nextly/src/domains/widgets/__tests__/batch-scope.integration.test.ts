/**
 * Work shared within a widget batch stays inside it: per batch, per caller, per
 * source, through the real endpoint and the real plugin boot.
 *
 * The scope is the one place two callers' reads could meet, so its isolation is
 * an access property, not a performance detail.
 *
 * Also the batch's two encodings through the real route: the streamed answer
 * carries each slot as the JSON answer holds it, a slot that settles first is
 * written first, and a card whose source never answers fails alone when its
 * budget runs out. On every configured dialect.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import type { PluginContext } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import type { WidgetQuery } from "../query";
import type { ResolverOptions } from "../resolved-sources";
import { clearSources } from "../sources";

// Prefixed for this file: on PostgreSQL and MySQL the table outlives a run on a reused database.
// Short, because the key fixture names a role after it, and a role slug holds 50 characters.
const NOTES = "bs_notes";

interface Slot {
  ok: boolean;
  error?: string;
  result?: { op: string; total?: number };
}

/** How many times each source's resolvers ran, so "per query" is observed, not assumed. */
const calls = { plain: 0 };

/** Whether the source that never answers was told to stop, when its budget ran out. */
const hanging = { aborted: false };

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
        {
          // Never answers, but honours its signal, as a resolver with a dead outbound call that
          // was handed the signal would.
          source: {
            id: "plugin:acme/hang",
            label: "Hang",
            kind: "plugin",
            supports: ["count"],
            fields: [{ name: "total", type: "number" }],
          },
          resolve: (
            _query: WidgetQuery,
            _caller: ReadCaller,
            _ctx: PluginContext,
            opts?: ResolverOptions
          ) =>
            new Promise<never>((_resolve, reject) => {
              opts?.signal?.addEventListener("abort", () => {
                hanging.aborted = true;
                reject(new Error("aborted"));
              });
            }),
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

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  let handle: TestNextly | undefined;
  let ownerId: string | undefined;

  beforeEach(async () => {
    calls.plain = 0;
    hanging.aborted = false;
    handle = await createTestNextly({
      ...(dialect === "sqlite" ? {} : { dialect }),
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

  /** The batch endpoint through the real route, as JSON or, with `stream`, as lines. */
  function post(
    key: string,
    queries: unknown[],
    stream = false
  ): Promise<Response> {
    const handlers = createDynamicHandlers();
    return handlers.POST(
      new Request("http://localhost/api/dashboard/query", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          ...(stream ? { accept: "application/x-ndjson" } : {}),
        },
        body: JSON.stringify({ queries }),
      }),
      { params: Promise.resolve({ params: ["dashboard", "query"] }) }
    );
  }

  async function query(key: string, queries: unknown[]): Promise<Slot[]> {
    const res = await post(key, queries);
    expect(res.status).toBe(200);
    return ((await res.json()) as { results: Slot[] }).results;
  }

  interface Line {
    index: number;
    slot: Slot;
  }

  /** Reads a streamed answer one write at a time, each write as the lines it carried. */
  function writesOf(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    return async (): Promise<Line[] | undefined> => {
      const { done, value } = await reader.read();
      if (done) return undefined;
      return decoder
        .decode(value)
        .split("\n")
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line) as Line);
    };
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

  describe("the batch, streamed through the real route", () => {
    it("writes each slot as the JSON answer holds it", async () => {
      const key = await keyHolding([`read-${NOTES}`]);
      const queries = [
        count("plugin:acme/a"),
        count(`collection:${NOTES}`),
        count("plugin:nobody/here"),
      ];

      const json = await query(key, queries);
      const res = await post(key, queries, true);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-ndjson");
      const text = await res.text();
      const lines = text
        .split("\n")
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line) as Line);

      expect(lines.map(line => line.index).sort()).toEqual([0, 1, 2]);
      for (const line of lines) expect(line.slot).toEqual(json[line.index]);
      // The control: an answer, a count of the collection, and a refusal, so a slot written at
      // another index would show.
      expect(json.map(slot => slot.ok)).toEqual([true, true, false]);
    });

    it("fails the card whose source never answers when its budget runs out, and only that card", async () => {
      const key = await keyHolding([`read-${NOTES}`]);
      // Time moves on its own, so the database keeps answering, and can be jumped past the budget.
      vi.useFakeTimers({
        shouldAdvanceTime: true,
        toFake: ["setTimeout", "clearTimeout"],
      });
      try {
        const next = writesOf(
          await post(
            key,
            [count("plugin:acme/hang"), count("plugin:acme/a")],
            true
          )
        );

        // The other card is drawn while the hung one is still running.
        expect(await next()).toEqual([
          { index: 1, slot: { ok: true, result: { op: "count", total: 1 } } },
        ]);
        expect(hanging.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(31_000);
        const [timedOut] = (await next()) ?? [];
        expect(timedOut?.index).toBe(0);
        expect(timedOut?.slot.ok).toBe(false);
        expect(timedOut?.slot.error).toMatch(/took too long/i);
        // Told, not merely abandoned.
        expect(hanging.aborted).toBe(true);
        expect(await next()).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

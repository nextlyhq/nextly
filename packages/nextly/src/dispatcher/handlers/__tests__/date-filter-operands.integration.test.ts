/**
 * A REST read filters a date column by an ISO 8601 value, on every configured
 * dialect, through the same handler a Next.js route mounts.
 *
 * A date column (the system `createdAt` and `updatedAt`, and every date field)
 * is read and written by Drizzle as a `Date`, and on SQLite its driver mapping
 * reads `getTime()` from the operand. A filter written the way rows read, with
 * an ISO string, threw there and answered 500 — the admin's own Created and
 * Updated filters among them — while PostgreSQL and MySQL handed the string to
 * the database to interpret. Each case below compares the list with its count,
 * so a filter the list honours and the count does not is seen too.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { date, defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const EVENTS = "dfo_events";

/**
 * Three events a month apart, each created, updated and held at a stated
 * instant, so every bound below is decided by those instants alone.
 */
const ROWS = [
  {
    title: "alpha",
    at: "2026-01-10T12:00:00.000Z",
    heldOn: "2026-05-10T12:00:00.000Z",
  },
  {
    title: "beta",
    at: "2026-02-10T12:00:00.000Z",
    heldOn: "2026-06-10T12:00:00.000Z",
  },
  {
    title: "gamma",
    at: "2026-03-10T12:00:00.000Z",
    heldOn: "2026-07-10T12:00:00.000Z",
  },
];

/**
 * Boot with the three events, and return an API key that may read them.
 *
 * The key is minted by the instance's first user, its super admin, for a role
 * holding only `read-<events>`, so the request reaches the read rather than
 * stopping at authentication.
 */
async function boot(dialect: TestDialect): Promise<string> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: EVENTS,
        access: { read: () => true, create: () => true },
        fields: [text({ name: "title" }), date({ name: "heldOn" })],
      }),
    ],
  });
  for (const row of ROWS) {
    const created = await current.nextly.create({
      collection: EVENTS,
      data: { title: row.title, heldOn: row.heldOn },
      overrideAccess: true,
    });
    const id = (created.item as { id: string }).id;
    // A write stamps its own instant, so the timestamps are set on the row.
    await current.adapter.update(
      `dc_${EVENTS}`,
      { created_at: new Date(row.at), updated_at: new Date(row.at) },
      { and: [{ column: "id", op: "=", value: id }] }
    );
  }

  const nextly = current.nextly as unknown as {
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
  const owner = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  const permissions = await nextly.permissions.find({ limit: 300 });
  const read = permissions.items.find(p => p.slug === `read-${EVENTS}`);
  expect(
    read,
    `\`read-${EVENTS}\` must be seeded, or the key below reads nothing and every answer is a refusal for the wrong reason`
  ).toBeDefined();
  const role = await nextly.roles.create({
    data: { name: "Reader", slug: "reader", permissionIds: [read!.id] },
  });
  const apiKeys = current.getService("apiKeyService") as unknown as {
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
  const { key } = await apiKeys.createApiKey(owner.item.id, {
    name: "reader",
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** A GET of the events list, or of its count, with the given query string. */
async function get(
  key: string,
  route: "entries" | "count",
  query: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const params =
    route === "entries"
      ? ["collections", EVENTS, "entries"]
      : ["collections", EVENTS, "entries", "count"];
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/${params.join("/")}?${query}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params }) }
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

const json = (where: unknown): string =>
  `where=${encodeURIComponent(JSON.stringify(where))}`;

/**
 * The titles a filter lists, after checking the count agrees: one filter,
 * one row set, whichever route reads it.
 */
async function filtered(key: string, query: string): Promise<string[]> {
  const listed = await get(key, "entries", query);
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  const titles = ((listed.body.items ?? []) as { title: string }[])
    .map(item => item.title)
    .sort();
  const counted = await get(key, "count", query);
  expect(counted.status, JSON.stringify(counted.body)).toBe(200);
  expect(counted.body.total).toBe(titles.length);
  return titles;
}

describe.each(getConfiguredTestDialects())(
  "a REST filter on a date column (%s)",
  dialect => {
    it("narrows by an instant range on createdAt and updatedAt, in either spelling", async () => {
      const key = await boot(dialect);
      // The control: unfiltered, every event.
      expect(await filtered(key, "")).toEqual(["alpha", "beta", "gamma"]);

      const february = {
        greater_than_equal: "2026-02-01T00:00:00.000Z",
        less_than: "2026-03-01T00:00:00.000Z",
      };
      expect(await filtered(key, json({ createdAt: february }))).toEqual([
        "beta",
      ]);
      expect(await filtered(key, json({ updatedAt: february }))).toEqual([
        "beta",
      ]);
      expect(
        await filtered(
          key,
          "where[createdAt][greater_than]=2026-02-10T12:00:00Z"
        )
      ).toEqual(["gamma"]);
      // An offset other than Z names the same instant it names in UTC.
      expect(
        await filtered(
          key,
          json({ createdAt: { equals: "2026-01-10T14:00:00+02:00" } })
        )
      ).toEqual(["alpha"]);
    });

    it("reads a bare date as the start of that day in UTC", async () => {
      const key = await boot(dialect);
      expect(
        await filtered(key, json({ createdAt: { less_than: "2026-02-10" } }))
      ).toEqual(["alpha"]);
      expect(
        await filtered(
          key,
          json({ createdAt: { greater_than_equal: "2026-02-10" } })
        )
      ).toEqual(["beta", "gamma"]);
    });

    it("filters a date field the same way", async () => {
      const key = await boot(dialect);
      expect(
        await filtered(
          key,
          json({ heldOn: { greater_than: "2026-06-01T00:00:00Z" } })
        )
      ).toEqual(["beta", "gamma"]);
      expect(
        await filtered(
          key,
          json({
            heldOn: {
              in: ["2026-05-10T12:00:00.000Z", "2026-07-10T12:00:00Z"],
            },
          })
        )
      ).toEqual(["alpha", "gamma"]);
    });

    it("compares a bound with a fraction of a second exactly", async () => {
      const key = await boot(dialect);
      // alpha was created at 12:00:00.000. Floored to the second, the first
      // bound would exclude it and the second would match it.
      expect(
        await filtered(
          key,
          json({ createdAt: { less_than: "2026-01-10T12:00:00.500Z" } })
        )
      ).toEqual(["alpha"]);
      expect(
        await filtered(
          key,
          json({ createdAt: { equals: "2026-01-10T12:00:00.500Z" } })
        )
      ).toEqual([]);
    });

    it("answers a bound far outside the stored years as it would any other", async () => {
      const key = await boot(dialect);
      // MySQL's TIMESTAMP holds 1970 to 2038, and a bound outside that range
      // must still compare, not match nothing.
      expect(
        await filtered(key, json({ createdAt: { less_than: "2100-01-01" } }))
      ).toEqual(["alpha", "beta", "gamma"]);
      expect(
        await filtered(key, json({ createdAt: { greater_than: "2100-01-01" } }))
      ).toEqual([]);
      expect(
        await filtered(key, json({ createdAt: { greater_than: "1900-01-01" } }))
      ).toEqual(["alpha", "beta", "gamma"]);
      expect(
        await filtered(key, json({ createdAt: { less_than: "1900-01-01" } }))
      ).toEqual([]);
    });

    it("answers 400 for a value no date can be read from", async () => {
      const key = await boot(dialect);
      const cases: Array<[string, string]> = [
        [
          "a date that does not exist",
          json({ createdAt: { less_than: "2026-02-30" } }),
        ],
        ["words", json({ createdAt: { less_than: "yesterday" } })],
        // A time with no zone names a different instant on every server.
        [
          "a time with no zone",
          json({ createdAt: { less_than: "2026-02-10T12:00:00" } }),
        ],
        ["a number", json({ heldOn: { greater_than: 20260101 } })],
        [
          "one bad member of a list",
          json({ heldOn: { in: ["2026-05-10", "soon"] } }),
        ],
      ];
      for (const [name, query] of cases) {
        for (const route of ["entries", "count"] as const) {
          const { status, body } = await get(key, route, query);
          expect(status, `${name} (${route}): ${JSON.stringify(body)}`).toBe(
            400
          );
          expect(JSON.stringify(body), name).toContain(
            "FILTER_INVALID_OPERAND"
          );
        }
      }
    });
  }
);

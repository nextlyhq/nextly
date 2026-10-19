/**
 * A REST read answers 400 for a `where` it cannot use, on every configured
 * dialect, through the same handler a Next.js route mounts.
 *
 * A malformed JSON `where` used to be parsed as no filter, and the bracket
 * form (`where[title][equals]=…`) was read into a field name that matched no
 * column, which the builder then skipped. Either way the request answered 200
 * with every entry. The fixture holds three entries, so a dropped filter is
 * visible as three rows; the control proves both spellings of a well-formed
 * filter narrow the read.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
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

/**
 * Boot with three notes, and return an API key that may read them.
 *
 * The key is minted by the instance's first user, its super admin, for a role
 * holding only `read-notes`, so the request reaches the read rather than
 * stopping at authentication.
 */
async function boot(dialect: TestDialect): Promise<string> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "notes",
        access: { read: () => true, create: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  for (const title of ["alpha", "beta", "gamma"]) {
    await current.nextly.create({
      collection: "notes",
      data: { title },
      overrideAccess: true,
    });
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
  const read = permissions.items.find(p => p.slug === "read-notes");
  expect(
    read,
    "`read-notes` must be seeded, or the key below reads nothing and every answer is a refusal for the wrong reason"
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

/** A GET of the notes list with the given query string. */
async function list(
  key: string,
  query: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/collections/notes/entries?${query}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    {
      params: Promise.resolve({
        params: ["collections", "notes", "entries"],
      }),
    }
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

const titles = (body: Record<string, unknown>): string[] =>
  ((body.items ?? []) as { title: string }[]).map(i => i.title).sort();

const json = (where: unknown): string =>
  `where=${encodeURIComponent(JSON.stringify(where))}`;

describe.each(getConfiguredTestDialects())(
  "REST where is refused when it cannot be used (%s)",
  dialect => {
    it("narrows the read with a well-formed where, in either spelling", async () => {
      const key = await boot(dialect);
      const all = await list(key, "");
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(titles(all.body)).toEqual(["alpha", "beta", "gamma"]);

      const viaJson = await list(key, json({ title: { equals: "alpha" } }));
      expect(viaJson.status).toBe(200);
      expect(titles(viaJson.body)).toEqual(["alpha"]);

      const viaBrackets = await list(key, "where[title][equals]=alpha");
      expect(viaBrackets.status).toBe(200);
      expect(titles(viaBrackets.body)).toEqual(["alpha"]);
    });

    it("answers 400 for each where it cannot use", async () => {
      const key = await boot(dialect);
      const cases: Array<[string, string, string]> = [
        ["malformed JSON", "where=%7Btitle%3A", "FILTER_INVALID_JSON"],
        [
          "an unknown operator",
          json({ title: { equal: "alpha" } }),
          "FILTER_UNKNOWN_OPERATOR",
        ],
        [
          "an unknown field",
          json({ titel: { equals: "alpha" } }),
          "FILTER_UNKNOWN_FIELD",
        ],
        [
          "an unknown operator in brackets",
          "where[title][equal]=alpha",
          "FILTER_UNKNOWN_OPERATOR",
        ],
        [
          "a JSON where and bracket conditions together",
          `${json({ title: { equals: "alpha" } })}&where[title][equals]=beta`,
          "FILTER_GIVEN_TWICE",
        ],
      ];
      for (const [name, query, code] of cases) {
        const { status, body } = await list(key, query);
        expect(status, `${name}: ${JSON.stringify(body)}`).toBe(400);
        expect(JSON.stringify(body), name).toContain(code);
      }
    });
  }
);

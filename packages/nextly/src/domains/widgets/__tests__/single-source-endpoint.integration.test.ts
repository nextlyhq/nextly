/**
 * A `single:` query through `POST /api/dashboard/query` -- the one production
 * caller of the executor -- on a real instance, with a real API key.
 *
 * `single-source-access.integration.test.ts` proves the EXECUTOR earns what a
 * read of the single earns, and `api/widget-query.test.ts` proves the
 * endpoint's gate against a mocked executor. Neither is the request path: the
 * domain could execute a single while the endpoint refused every `single:`
 * query as "not executable yet", and both suites stayed green. This is the
 * whole chain, refresh included -- nothing here publishes a source before the
 * request does, so a row coming back is the endpoint's own refresh reaching
 * the singles registry.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { clearSources } from "../sources";

const SETTINGS = "site-settings";
const PRIVATE = "private-notes";

interface Slot {
  ok: boolean;
  error?: string;
  result?: { op: string; items?: Record<string, unknown>[] };
}

let handle: TestNextly | undefined;
/** The instance's first user, created once: the super admin every key is minted by. */
let ownerId: string | undefined;

beforeEach(async () => {
  handle = await createTestNextly({
    singles: [
      defineSingle({
        slug: SETTINGS,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "siteName" }), text({ name: "tagline" })],
      }),
      defineSingle({
        slug: PRIVATE,
        access: { read: () => false, update: () => true },
        fields: [text({ name: "note" })],
      }),
    ],
  });
  await handle.nextly.updateSingle({
    slug: SETTINGS,
    data: { siteName: "Acme", tagline: "Hello" },
    overrideAccess: true,
  });
  // A cold process: boot publishes no source, and a previous test in this
  // file must not have left one standing for this request to find.
  clearSources();
});

afterEach(async () => {
  clearSources();
  await handle?.destroy();
  handle = undefined;
  ownerId = undefined;
});

/**
 * A key holding exactly the grants named, minted by the super-admin first
 * user through the same role table the product reads. One owner per
 * instance: only the FIRST user is the super admin, and a key may not hold
 * more than its owner does.
 */
async function keyHolding(slugs: string[]): Promise<string> {
  const nextly = handle!.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
    permissions: {
      find: (a: { limit: number }) => Promise<{
        items: { id: string; slug: string }[];
      }>;
    };
    roles: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
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
    expect(
      found,
      `\`${slug}\` must be seeded, or the role below grants nothing and a ` +
        "refusal here is for the wrong reason"
    ).toBeDefined();
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

describe("POST /api/dashboard/query with a single: source", () => {
  it("answers the one document, projected, to a key holding the single's read grant", async () => {
    // `status: "all"`, because the document is a draft: a lifecycle single
    // asked for its published state alone answers an empty list, by design.
    const [slot] = await query(await keyHolding([`read-${SETTINGS}`]), [
      {
        source: `single:${SETTINGS}`,
        op: "list",
        select: ["siteName"],
        status: "all",
      },
    ]);

    expect(slot.error).toBeUndefined();
    expect(slot.ok).toBe(true);
    expect(slot.result?.op).toBe("list");
    expect(slot.result?.items).toEqual([{ siteName: "Acme" }]);
  });

  it("refuses a single the key lacks, one its code rule refuses, and one that does not exist, all alike", async () => {
    // One batch, so the population control travels with the refusals: the
    // grant the key holds answers, and the three dead ends share the one
    // sentence that names none of them.
    const slots = await query(
      await keyHolding([`read-${SETTINGS}`, `read-${PRIVATE}`]),
      [
        { source: `single:${SETTINGS}`, op: "list", select: ["siteName"] },
        { source: `single:${PRIVATE}`, op: "list", select: ["note"] },
        { source: "single:not-a-single", op: "list", select: ["note"] },
      ]
    );
    const [held, ruled, absent] = slots;

    expect(held.ok).toBe(true);
    expect(ruled.ok).toBe(false);
    expect(absent.ok).toBe(false);
    expect(ruled.error).toBe(absent.error);
    expect(ruled.error).not.toContain(PRIVATE);

    // The grant the key LACKS, refused before the rule is even asked.
    const [lacking] = await query(await keyHolding([`read-${SETTINGS}`]), [
      { source: `single:${PRIVATE}`, op: "list", select: ["note"] },
    ]);
    expect(lacking.ok).toBe(false);
    expect(lacking.error).toBe(absent.error);
  });
});

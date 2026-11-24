/**
 * The entry list's language filters and its titles in a chosen language, read through the REST
 * door exactly as the admin list sends them, on every configured dialect.
 *
 * "Missing in <language>" and "Out of date in <language>" are the top-level `_translated` key
 * (`missing`, `stale`) beside `translation-status=1`; titles in a language are a read of the
 * page's rows by id in that language with no fallback. Each is judged by the collection's read
 * rule as any read is: a row the rule withholds is never in either filter, its state and title
 * are never returned, and a rule refusing a language refuses every read judged in it. A read
 * carrying the per-language state or filtered by it is judged in every language; a titles read
 * only in its own.
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
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Whether the read rule refuses any read judged in Arabic; flipped by a case. */
const rule = { refuseArabic: false };

interface Fixture {
  key: string;
  /** Public: Spanish written, then the English title changed. */
  stale: string;
  /** Public: Spanish written after the English, and nothing changed since. */
  fresh: string;
  /** Public: English only. */
  missing: string;
  /** Withheld by the rule: English only. */
  hiddenMissing: string;
  /** Withheld by the rule: Spanish written, then the English title changed. */
  hiddenStale: string;
}

/**
 * Boot with five posts, and return an API key whose role may read them, so every request is
 * judged by the collection's rule: it shows the public team's posts only, and, when
 * `rule.refuseArabic` is set, refuses any read whose languages include Arabic.
 */
async function boot(dialect: TestDialect): Promise<Fixture> {
  rule.refuseArabic = false;
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        access: {
          read: ({ locales }) =>
            rule.refuseArabic && locales.includes("ar")
              ? false
              : ({ team: { equals: "public" } } as unknown as boolean),
          create: () => true,
        },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "team", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "es", "ar"], defaultLocale: "en" },
  });
  const t = current;
  const handler = t.getService(
    "collectionsHandler"
  ) as unknown as CollectionsHandler;

  const create = async (title: string, team: string): Promise<string> => {
    const created = (await t.nextly.create({
      collection: "posts",
      locale: "en",
      data: { title, team },
      overrideAccess: true,
    })) as unknown as { item: { id: string } };
    return created.item.id;
  };
  const write = async (
    id: string,
    locale: string,
    data: Record<string, unknown>
  ): Promise<void> => {
    const result = await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: id,
        overrideAccess: true,
        locale,
        user: { id: "seed" },
      },
      { ...data, _overwrite: true }
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
  };

  const stale = await create("Stale", "public");
  const fresh = await create("Fresh", "public");
  const missing = await create("Missing", "public");
  const hiddenMissing = await create("Hidden missing", "private");
  const hiddenStale = await create("Hidden stale", "private");
  await write(stale, "es", { title: "Viejo" });
  await write(fresh, "es", { title: "Fresco" });
  await write(hiddenStale, "es", { title: "Oculto" });
  // A second later, so the English change is written after the Spanish on a dialect whose
  // timestamps keep whole seconds.
  await new Promise(resolve => setTimeout(resolve, 1100));
  await write(stale, "en", { title: "Stale, changed" });
  await write(hiddenStale, "en", { title: "Hidden stale, changed" });

  return {
    key: await readerKey(t),
    stale,
    fresh,
    missing,
    hiddenMissing,
    hiddenStale,
  };
}

/**
 * An API key for a role holding only `read-posts`, minted by the instance's first user, its
 * super admin, so a request reaches the read and the collection's rule decides it.
 */
async function readerKey(t: TestNextly): Promise<string> {
  const nextly = t.nextly as unknown as {
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
  const read = permissions.items.find(p => p.slug === "read-posts");
  expect(
    read,
    "`read-posts` must be seeded, or every answer below is a refusal for the wrong reason"
  ).toBeDefined();
  const role = await nextly.roles.create({
    data: { name: "Reader", slug: "reader", permissionIds: [read!.id] },
  });
  const apiKeys = t.getService("apiKeyService") as unknown as {
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

type Item = {
  id: string;
  title?: unknown;
  _translations?: Record<string, { translated?: boolean; stale?: boolean }>;
};

/** A GET of the posts list with the given query, as the admin list sends it. */
async function list(
  key: string,
  query: string
): Promise<{ status: number; items: Item[] | undefined; body: unknown }> {
  const res = await createDynamicHandlers().GET(
    new Request(`http://localhost/api/collections/posts/entries?${query}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    {
      params: Promise.resolve({
        params: ["collections", "posts", "entries"],
      }),
    }
  );
  const body = (await res.json()) as { items?: Item[] };
  return { status: res.status, items: body.items, body };
}

const where = (filter: unknown): string =>
  `where=${encodeURIComponent(JSON.stringify(filter))}`;

/** The list read with every language's state, filtered by one language's state. */
const filtered = (locale: string, state: string): string =>
  `status=all&limit=50&translation-status=1&${where({ _translated: { locale, state } })}`;

/** The titles read: the rows by id, in one language, with no fallback and no relations. */
const titlesIn = (locale: string, ids: readonly string[]): string =>
  `status=all&limit=${ids.length}&locale=${locale}&fallback-locale=none&depth=0&${where({ id: { in: ids } })}`;

const idsOf = (items: Item[] | undefined): string[] =>
  (items ?? []).map(item => item.id).sort();

/** A read that was refused, and returned no row. */
function expectRefused(
  answer: { status: number; items: Item[] | undefined; body: unknown },
  what: string
): void {
  expect([403, 404], `${what}: ${JSON.stringify(answer.body)}`).toContain(
    answer.status
  );
  expect(answer.items, what).toBeUndefined();
}

describe.each(getConfiguredTestDialects())(
  "the entry list's language filters and titles (integration, %s)",
  dialect => {
    it("lists the posts missing in a language, never one the rule withholds", async () => {
      const f = await boot(dialect);

      // CONTROL: unfiltered, the reader sees the three public posts, so the rule is live and the
      // filter below has something to narrow.
      const all = await list(f.key, "status=all&limit=50&translation-status=1");
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(idsOf(all.items)).toEqual([f.stale, f.fresh, f.missing].sort());

      const missing = await list(f.key, filtered("es", "missing"));
      expect(missing.status, JSON.stringify(missing.body)).toBe(200);
      expect(idsOf(missing.items)).toEqual([f.missing]);
      expect(missing.items?.[0]?._translations?.es?.translated).toBe(false);
      // Withheld, though missing in Spanish too: neither the row nor its state comes back.
      expect(JSON.stringify(missing.body)).not.toContain(f.hiddenMissing);
    });

    it("lists the posts out of date in a language, never one the rule withholds", async () => {
      const f = await boot(dialect);

      const outOfDate = await list(f.key, filtered("es", "stale"));
      expect(outOfDate.status, JSON.stringify(outOfDate.body)).toBe(200);
      // The fresh translation is the control: translated, and not out of date.
      expect(idsOf(outOfDate.items)).toEqual([f.stale]);
      expect(outOfDate.items?.[0]?._translations?.es?.stale).toBe(true);
      expect(JSON.stringify(outOfDate.body)).not.toContain(f.hiddenStale);
    });

    it("reads titles in a language without filling in the default's, only for rows the rule shows", async () => {
      const f = await boot(dialect);
      const every = [
        f.stale,
        f.fresh,
        f.missing,
        f.hiddenMissing,
        f.hiddenStale,
      ];

      const spanish = await list(f.key, titlesIn("es", every));
      expect(spanish.status, JSON.stringify(spanish.body)).toBe(200);
      expect(idsOf(spanish.items)).toEqual(
        [f.stale, f.fresh, f.missing].sort()
      );
      const title = (id: string) =>
        spanish.items?.find(item => item.id === id)?.title;
      expect(title(f.stale)).toBe("Viejo");
      expect(title(f.fresh)).toBe("Fresco");
      // No Spanish title, and no fallback: the English one is not passed off as Spanish.
      expect(title(f.missing)).not.toBe("Missing");
      expect(JSON.stringify(spanish.body)).not.toContain("Oculto");
    });

    it("refuses every read judged in a language the rule refuses, and still reads titles in another", async () => {
      const f = await boot(dialect);
      rule.refuseArabic = true;

      // The list with every language's state, and the list filtered by one language's state, are
      // judged in every language, Arabic among them.
      expectRefused(
        await list(f.key, "status=all&limit=50&translation-status=1"),
        "the list with every language's state"
      );
      expectRefused(
        await list(
          f.key,
          `status=all&limit=50&${where({ _translated: { locale: "es", state: "missing" } })}`
        ),
        "the list filtered by Spanish's state"
      );
      expectRefused(
        await list(f.key, titlesIn("ar", [f.stale, f.fresh])),
        "the titles in Arabic"
      );

      // CONTROL: the titles in Spanish are judged in Spanish alone, so they are still read.
      const spanish = await list(f.key, titlesIn("es", [f.stale, f.fresh]));
      expect(spanish.status, JSON.stringify(spanish.body)).toBe(200);
      expect(idsOf(spanish.items)).toEqual([f.stale, f.fresh].sort());
    });
  }
);

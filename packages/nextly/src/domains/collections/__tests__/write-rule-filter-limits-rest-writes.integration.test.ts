/**
 * A collection's write rules that answer a filter limit what a REST request
 * may change to the entries the filter matches, as the Direct API's writes
 * are limited.
 *
 * The route lets the caller through on the filter it answered, and the write
 * matches the entry against that filter. An entry outside it is refused and
 * left as it was: with a 403 where the caller may read it, and as a missing
 * entry (404) where it may not. Asked of an update, a delete, and the writes
 * an editor makes through an entry's versions: a restore, a discard of the
 * held edit, and an autosave.
 *
 * Taking the live shared values into a held edit matches the filter in the
 * language of that edit, and a take or a discard asks the update again under
 * the entry's lock, so a change after the first ask cannot slip past it.
 *
 * @module domains/collections/__tests__/write-rule-filter-limits-rest-writes.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import { VersionsRepository } from "../../versions/versions-repository";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const POSTS = "restfilter_posts";
// The same rules over entries only their owner may read.
const OWN_POSTS = "restfilter_own_posts";
// Published entries whose edits are held as a pending change.
const DRAFTED = "restfilter_drafted";

const AUTHOR = "restfilter-author";
const OTHER = "restfilter-other";

/** "Only the caller's own": a filter over the entry's `owner`. */
const ownEntries = ({ user }: { user: { id: string } | null }) =>
  ({ owner: { equals: user?.id ?? "" } }) as unknown as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
});

async function boot(): Promise<TestNextly> {
  const writes = {
    update: ownEntries,
    delete: ownEntries,
    publish: ownEntries,
    unpublish: ownEntries,
  };
  const fields = [text({ name: "title" }), text({ name: "owner" })];
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: { read: () => true, ...writes },
        fields,
      }),
      defineCollection({
        slug: OWN_POSTS,
        status: true,
        access: { read: ownEntries, ...writes },
        fields,
      }),
      defineCollection({
        slug: DRAFTED,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, ...writes },
        fields,
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds each one.
  const all = [POSTS, OWN_POSTS, DRAFTED];
  await userWhoMay(current, AUTHOR, "read", all);
  for (const action of ["update", "delete", "publish", "unpublish"]) {
    await grantTo(current, AUTHOR, action, all);
  }
  return current;
}

/** The author's own entry and another's, in `collection`. */
async function seed(
  t: TestNextly,
  collection: string,
  status = "draft"
): Promise<{ own: string; others: string }> {
  const own = await t.nextly.create({
    collection,
    data: { title: "mine", owner: AUTHOR, status },
  });
  const others = await t.nextly.create({
    collection,
    data: { title: "theirs", owner: OTHER, status },
  });
  return { own: String(own.item.id), others: String(others.item.id) };
}

/** The stored row of `id`, read past every access check. */
async function stored(
  t: TestNextly,
  collection: string,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    `dc_${collection}`,
    {}
  );
  return rows.find(row => String(row.id) === id);
}

/** A REST request as the author, answered with its status. */
async function rest(
  method: "PATCH" | "POST" | "PUT" | "DELETE",
  path: string[],
  body?: unknown,
  query = ""
): Promise<number> {
  const token = await signAccessToken(
    buildClaims({
      userId: AUTHOR,
      email: `${AUTHOR}@example.test`,
      name: AUTHOR,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const handlers = createDynamicHandlers() as unknown as Record<
    string,
    (request: Request, context: unknown) => Promise<Response>
  >;
  const res = await handlers[method]!(
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method,
      headers: {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return res.status;
}

/**
 * Gives entry `id` of `collection` to `OTHER` the moment a transaction locks
 * its row, in that transaction: what a concurrent write committed just before
 * the lock leaves behind. A check made before the lock still sees the
 * author's entry; only one made under it sees another's. Counts the times it
 * gave the entry away, so a test can tell the lock was reached.
 */
function giveAwayAtLock(
  t: TestNextly,
  collection: string,
  id: string
): { given: number } {
  const table = `dc_${collection}`;
  const gave = { given: 0 };
  const transaction = t.adapter.transaction.bind(t.adapter);
  vi.spyOn(t.adapter, "transaction").mockImplementation((callback, options) =>
    transaction(tx => {
      const lockRow = tx.lockRow.bind(tx);
      tx.lockRow = async (locked, rowId) => {
        await lockRow(locked, rowId);
        if (locked === table && String(rowId) === id) {
          await tx.update(
            table,
            { owner: OTHER },
            { and: [{ column: "id", op: "=", value: id }] }
          );
          gave.given++;
        }
      };
      return callback(tx);
    }, options)
  );
  return gave;
}

const entry = (collection: string, id: string) => [
  "collections",
  collection,
  "entries",
  id,
];

describe("a REST update or delete whose rule answers a filter", () => {
  it("updates the author's own entry, and refuses another's it may read with a 403, leaving it", async () => {
    const t = await boot();
    const { own, others } = await seed(t, POSTS);
    const before = await stored(t, POSTS, others);

    expect(await rest("PATCH", entry(POSTS, own), { title: "renamed" })).toBe(
      200
    );
    expect(
      await rest("PATCH", entry(POSTS, others), { title: "renamed" })
    ).toBe(403);
    expect((await stored(t, POSTS, own))?.title).toBe("renamed");
    expect(await stored(t, POSTS, others)).toEqual(before);
  });

  it("answers another's entry it may not read as missing", async () => {
    const t = await boot();
    const { others } = await seed(t, OWN_POSTS);
    const before = await stored(t, OWN_POSTS, others);

    expect(
      await rest("PATCH", entry(OWN_POSTS, others), { title: "renamed" })
    ).toBe(404);
    expect(await rest("DELETE", entry(OWN_POSTS, others))).toBe(404);
    expect(await stored(t, OWN_POSTS, others)).toEqual(before);
  });

  it("refuses an update moving the entry out of the filter, changing nothing", async () => {
    const t = await boot();
    const { own } = await seed(t, POSTS);
    const before = await stored(t, POSTS, own);

    expect(await rest("PATCH", entry(POSTS, own), { owner: OTHER })).toBe(403);
    expect(await stored(t, POSTS, own)).toEqual(before);
  });

  it("deletes the author's own entry, and refuses another's, leaving it", async () => {
    const t = await boot();
    const { own, others } = await seed(t, POSTS);

    expect(await rest("DELETE", entry(POSTS, own))).toBe(200);
    expect(await rest("DELETE", entry(POSTS, others))).toBe(403);
    expect(await stored(t, POSTS, own)).toBeUndefined();
    expect(await stored(t, POSTS, others)).toBeDefined();
  });
});

// A write in one language reads and writes that language's row, so it runs
// on each database this run reaches.
describe.each(getConfiguredTestDialects())(
  "a REST update in one language whose rule answers a filter (%s)",
  dialect => {
    // The route judges the write in the languages it writes, which hold the one
    // the update writes, so its kept filter answers the update's question.
    const LOCALIZED = "restfilter_localized_posts";

    it("updates the author's own entry in German, and refuses another's", async () => {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: LOCALIZED,
            localized: true,
            status: true,
            access: { read: () => true, update: ownEntries },
            fields: [
              text({ name: "title" }),
              text({ name: "owner", localized: false }),
            ],
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [LOCALIZED]);
      await grantTo(t, AUTHOR, "update", [LOCALIZED]);
      const { own, others } = await seed(t, LOCALIZED);

      expect(
        await rest(
          "PATCH",
          entry(LOCALIZED, own),
          { title: "deutsch" },
          "?locale=de"
        )
      ).toBe(200);
      expect(
        await rest(
          "PATCH",
          entry(LOCALIZED, others),
          { title: "deutsch" },
          "?locale=de"
        )
      ).toBe(403);
    });
  }
);

describe("an editor's write through an entry's versions whose update rule answers a filter", () => {
  it("restores a version of the author's own entry, and refuses another's", async () => {
    const t = await boot();
    const { own, others } = await seed(t, DRAFTED);
    const before = await stored(t, DRAFTED, others);

    expect(
      await rest("POST", [...entry(DRAFTED, own), "versions", "1", "restore"])
    ).toBe(200);
    expect(
      await rest("POST", [
        ...entry(DRAFTED, others),
        "versions",
        "1",
        "restore",
      ])
    ).toBe(403);
    expect(await stored(t, DRAFTED, others)).toEqual(before);
  });

  it("discards the held edit of the author's own entry, and refuses another's", async () => {
    const t = await boot();
    const { own, others } = await seed(t, DRAFTED, "published");
    // Held by a trusted write, so each entry has an edit to discard.
    for (const id of [own, others]) {
      await t.nextly.update({
        collection: DRAFTED,
        id,
        data: { title: "held" },
      } as never);
    }

    expect(
      await rest("DELETE", [
        ...entry(DRAFTED, own),
        "versions",
        "working-draft",
      ])
    ).toBe(200);
    expect(
      await rest("DELETE", [
        ...entry(DRAFTED, others),
        "versions",
        "working-draft",
      ])
    ).toBe(403);
  });

  it("takes the live shared values into the author's own held edit, and refuses another's", async () => {
    // A held edit in German on each published entry, so each has a pending
    // change to bring up to date.
    const LOCALIZED_DRAFTS = "restfilter_localized_drafts";
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: LOCALIZED_DRAFTS,
          localized: true,
          status: true,
          versions: { drafts: true },
          access: { read: () => true, update: ownEntries },
          fields: [
            text({ name: "title" }),
            text({ name: "owner", localized: false }),
          ],
        }),
      ],
    });
    const t = current;
    await userWhoMay(t, AUTHOR, "read", [LOCALIZED_DRAFTS]);
    await grantTo(t, AUTHOR, "update", [LOCALIZED_DRAFTS]);
    const { own, others } = await seed(t, LOCALIZED_DRAFTS, "published");
    for (const id of [own, others]) {
      await t.nextly.update({
        collection: LOCALIZED_DRAFTS,
        id,
        locale: "de",
        data: { title: "entwurf" },
      } as never);
    }
    const takeLive = (id: string) =>
      rest(
        "POST",
        [
          ...entry(LOCALIZED_DRAFTS, id),
          "versions",
          "working-draft",
          "take-live",
        ],
        {},
        "?locale=de"
      );

    expect(await takeLive(own)).toBe(200);
    expect(await takeLive(others)).toBe(403);
  });

  it("autosaves the author's own entry, and refuses another's", async () => {
    const t = await boot();
    const { own, others } = await seed(t, DRAFTED);

    expect(
      await rest("PUT", [...entry(DRAFTED, own), "versions", "autosave"], {
        title: "typed",
        owner: AUTHOR,
      })
    ).toBe(200);
    expect(
      await rest("PUT", [...entry(DRAFTED, others), "versions", "autosave"], {
        title: "typed",
        owner: OTHER,
      })
    ).toBe(403);
  });
});

// Each language's row and the entry's lock: on each database this run
// reaches.
describe.each(getConfiguredTestDialects())(
  "an editor's write through an entry's versions, in its language and under its lock (%s)",
  dialect => {
    const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };
    // `owner` is translated, so an entry can be the author's in one language
    // and another's in the other.
    const translatedOwner = [text({ name: "title" }), text({ name: "owner" })];

    /** A published entry the author owns in English and `OTHER` owns in German, with a held edit in German. */
    async function ownedInEnglishOnly(
      t: TestNextly,
      collection: string
    ): Promise<string> {
      const made = await t.nextly.create({
        collection,
        data: { title: "mine", owner: AUTHOR, status: "published" },
      });
      const id = String(made.item.id);
      await t.nextly.update({
        collection,
        id,
        locale: "de",
        data: { title: "meins", owner: OTHER, status: "published" },
      } as never);
      await t.nextly.update({
        collection,
        id,
        locale: "de",
        data: { title: "entwurf" },
      } as never);
      return id;
    }

    it("matches a take of the live values against the filter in the held edit's language", async () => {
      const SLUG = "restfilter_take_language";
      current = await createTestNextly({
        dialect,
        localization: LANGUAGES,
        collections: [
          defineCollection({
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: ownEntries },
            fields: translatedOwner,
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [SLUG]);
      await grantTo(t, AUTHOR, "update", [SLUG]);
      const id = await ownedInEnglishOnly(t, SLUG);

      // The German edit is another's in German: refused, though the entry is
      // the author's in English.
      expect(
        await rest(
          "POST",
          [...entry(SLUG, id), "versions", "working-draft", "take-live"],
          {},
          "?locale=de"
        )
      ).toBe(403);
    });

    it("matches an autosave against the filter in the language it saves", async () => {
      const SLUG = "restfilter_autosave_language";
      current = await createTestNextly({
        dialect,
        localization: LANGUAGES,
        collections: [
          defineCollection({
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: ownEntries },
            fields: translatedOwner,
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [SLUG]);
      await grantTo(t, AUTHOR, "update", [SLUG]);
      const id = await ownedInEnglishOnly(t, SLUG);
      const autosave = (query: string) =>
        rest(
          "PUT",
          [...entry(SLUG, id), "versions", "autosave"],
          { title: "typed" },
          query
        );

      // The author's in English, another's in German.
      expect(await autosave("?locale=en")).toBe(200);
      expect(await autosave("?locale=de")).toBe(403);
    });

    it("takes the live values into a held edit the filter matches in its language", async () => {
      const SLUG = "restfilter_take_matched";
      current = await createTestNextly({
        dialect,
        localization: LANGUAGES,
        collections: [
          defineCollection({
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: ownEntries },
            fields: translatedOwner,
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [SLUG]);
      await grantTo(t, AUTHOR, "update", [SLUG]);
      const made = await t.nextly.create({
        collection: SLUG,
        data: { title: "mine", owner: AUTHOR, status: "published" },
      });
      const id = String(made.item.id);
      await t.nextly.update({
        collection: SLUG,
        id,
        locale: "de",
        data: { title: "meins", owner: AUTHOR, status: "published" },
      } as never);
      await t.nextly.update({
        collection: SLUG,
        id,
        locale: "de",
        data: { title: "entwurf" },
      } as never);

      expect(
        await rest(
          "POST",
          [...entry(SLUG, id), "versions", "working-draft", "take-live"],
          {},
          "?locale=de"
        )
      ).toBe(200);
    });

    it("restores a version the filter matches in the version's language", async () => {
      const SLUG = "restfilter_restore_matched";
      current = await createTestNextly({
        dialect,
        localization: LANGUAGES,
        collections: [
          defineCollection({
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: ownEntries },
            fields: translatedOwner,
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [SLUG]);
      await grantTo(t, AUTHOR, "update", [SLUG]);
      const made = await t.nextly.create({
        collection: SLUG,
        data: { title: "mine", owner: AUTHOR, status: "published" },
      });
      const id = String(made.item.id);
      await t.nextly.update({
        collection: SLUG,
        id,
        locale: "de",
        data: { title: "meins", owner: AUTHOR, status: "published" },
      } as never);
      const german = (
        await new VersionsRepository(t.adapter).newestVersionNoByLocale(
          { scopeKind: "collection", scopeSlug: SLUG, entryId: id },
          ["de"]
        )
      ).get("de");
      expect(german).toBeDefined();

      expect(
        await rest("POST", [
          ...entry(SLUG, id),
          "versions",
          String(german),
          "restore",
        ])
      ).toBe(200);
    });

    it("matches a take of the live values again under the entry's lock", async () => {
      const SLUG = "restfilter_take_locked";
      current = await createTestNextly({
        dialect,
        localization: LANGUAGES,
        collections: [
          defineCollection({
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: ownEntries },
            fields: [
              text({ name: "title" }),
              text({ name: "owner", localized: false }),
            ],
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [SLUG]);
      await grantTo(t, AUTHOR, "update", [SLUG]);
      const made = await t.nextly.create({
        collection: SLUG,
        data: { title: "mine", owner: AUTHOR, status: "published" },
      });
      const id = String(made.item.id);
      await t.nextly.update({
        collection: SLUG,
        id,
        locale: "de",
        data: { title: "entwurf" },
      } as never);
      const entries = t
        .getService("collectionsHandler")
        .getEntryService() as CollectionEntryService;
      const gave = giveAwayAtLock(t, SLUG, id);

      const taken = await entries.takeLiveSharedValues({
        collectionName: SLUG,
        entryId: id,
        locale: "de",
        user: { id: AUTHOR },
        overrideAccess: false,
      });

      expect(gave.given).toBe(1);
      expect(taken.success).toBe(false);
      expect(taken.statusCode).toBe(403);
    });

    it("matches a discard of the held edit again under the entry's lock", async () => {
      const SLUG = "restfilter_discard_locked";
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: SLUG,
            status: true,
            versions: { drafts: true },
            access: { read: () => true, update: ownEntries },
            fields: [text({ name: "title" }), text({ name: "owner" })],
          }),
        ],
      });
      const t = current;
      await userWhoMay(t, AUTHOR, "read", [SLUG]);
      await grantTo(t, AUTHOR, "update", [SLUG]);
      const { own } = await seed(t, SLUG, "published");
      await t.nextly.update({
        collection: SLUG,
        id: own,
        data: { title: "held" },
      } as never);
      const gave = giveAwayAtLock(t, SLUG, own);

      const status = await rest("DELETE", [
        ...entry(SLUG, own),
        "versions",
        "working-draft",
      ]);

      expect(gave.given).toBe(1);
      expect(status).toBe(403);
      // The held edit is still there to publish or discard.
      expect(
        await new VersionsRepository(t.adapter).findWorkingDraft(
          { scopeKind: "collection", scopeSlug: SLUG, entryId: own },
          null
        )
      ).toBeDefined();
    });
  }
);

/**
 * A restore through REST writes the working draft of the parts the version
 * holds, and never what is published.
 *
 * A version holds one language's translatable values and the shared fields.
 * Restoring it puts the chosen fields (all of them unless `fields` names some)
 * into that language's draft and the shared draft, and leaves the published
 * row, every public read, and every other language's draft as they were. A
 * collection or Single kept without drafts has no working draft to write, so
 * its restore is refused before anything changes.
 *
 * Each "unchanged" assertion stands beside the positive one that shows the
 * restore did land: a refused restore would also leave everything unchanged.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, defineSingle, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ServiceContainer } from "../../../services/index";

const ORIGIN = "http://localhost";
/** Translated, kept with drafts: `title` and `body` per language, `views` shared. */
const TRANSLATED = "rdposts";
/** Kept with versions as history only: no working draft to write. */
const HISTORY_ONLY = "rdnotes";
/** A Single kept with versions as history only. */
const HISTORY_ONLY_SINGLE = "rdbanner";
const ADMIN = "restorer";

let handle: TestNextly | undefined;
let cookie: Record<string, string> = {};

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    collections: [
      defineCollection({
        slug: TRANSLATED,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          text({ name: "body" }),
          number({ name: "views" }),
        ],
      }),
      defineCollection({
        slug: HISTORY_ONLY,
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: HISTORY_ONLY_SINGLE,
        versions: true,
        fields: [text({ name: "headline" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  await superAdminUser(handle, ADMIN);
  const role = await new ServiceContainer(
    handle.adapter
  ).roles.ensureSuperAdminRole();
  const token = await signAccessToken(
    buildClaims({
      userId: ADMIN,
      email: `${ADMIN}@example.test`,
      name: ADMIN,
      image: null,
      roleIds: [String(role.id)],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  cookie = { cookie: `nextly_session=${token}` };
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** One POST through the REST catch-all, as a signed-in admin sends it. */
async function post(
  path: string,
  body: Record<string, unknown> = {}
): Promise<Response> {
  const segments = path.split("/").filter(Boolean);
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...cookie },
    // Restored over whatever is there now, as the tests' saves are made.
    body: JSON.stringify({ _overwrite: true, ...body }),
  });
  return createDynamicHandlers().POST(req, {
    params: Promise.resolve({ params: segments }),
  });
}

/** Writes `data` to the entry in `locale`, as an editor's save does. */
async function save(
  entries: CollectionEntryService,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  // Made over whatever is there now: these saves follow one another.
  const saved = await entries.updateEntry(
    { collectionName: TRANSLATED, entryId: id, overrideAccess: true, locale },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** The newest durable version of the entry: the one the last save recorded. */
async function newestVersion(
  scopeKind: "collection" | "single",
  scopeSlug: string,
  entryId: string
): Promise<number> {
  const versions = handle!.getService("versionsService");
  const parts = await versions.listPartVersions({
    scopeKind,
    scopeSlug,
    entryId,
  });
  return Math.max(...parts.map(part => part.versionNo));
}

/** The entry's working drafts as stored, by slot (`shared` for none). */
async function drafts(
  entryId: string
): Promise<Record<string, Record<string, unknown>>> {
  const rows = await handle!.adapter.select<{
    locale: string | null;
    snapshot: unknown;
  }>("nextly_versions", {
    where: {
      and: [
        { column: "entryId", op: "=", value: entryId },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  const bySlot: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    bySlot[row.locale ?? "shared"] =
      typeof row.snapshot === "string"
        ? (JSON.parse(row.snapshot) as Record<string, unknown>)
        : (row.snapshot as Record<string, unknown>);
  }
  return bySlot;
}

/** What a public read of the entry in `locale` serves: its published values. */
async function published(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<Record<string, unknown>> {
  const res = await entries.getEntry({
    collectionName: TRANSLATED,
    entryId: id,
    overrideAccess: true,
    locale,
  });
  expect(res.success, JSON.stringify(res)).toBe(true);
  return res.data as Record<string, unknown>;
}

/** A document published in English and Spanish, with `views` at 10. */
async function publishedInBoth(
  entries: CollectionEntryService
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: TRANSLATED, overrideAccess: true, locale: "en" },
    { title: "en one", body: "en body", views: 10, status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  await save(entries, id, "es", {
    title: "es one",
    body: "es body",
    status: "published",
  });
  return id;
}

const restorePath = (id: string, versionNo: number) =>
  `collections/${TRANSLATED}/entries/${id}/versions/${versionNo}/restore`;

describe.each(getConfiguredTestDialects())(
  "a restore through REST writes drafts of the version's parts (%s)",
  dialect => {
    it("restores a published version into the working draft, and leaves what is published", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      const first = await newestVersion("collection", TRANSLATED, id);
      await save(entries, id, "en", {
        title: "en two",
        views: 11,
        status: "published",
      });
      // The English version holding "en one" and views 10.
      const englishFirst = (
        await handle!.getService("versionsService").listPartVersions({
          scopeKind: "collection",
          scopeSlug: TRANSLATED,
          entryId: id,
        })
      )
        .filter(part => part.locale === "en" && part.versionNo < first)
        .sort((a, b) => b.versionNo - a.versionNo)[0]?.versionNo;
      expect(englishFirst).toBeDefined();

      const res = await post(restorePath(id, englishFirst!));
      expect(res.status, await res.clone().text()).toBe(200);

      // It landed in the drafts...
      const stored = await drafts(id);
      expect(stored.en?.title).toBe("en one");
      expect(stored.shared?.views).toBe(10);
      // ...and nothing published moved.
      expect(await published(entries, id, "en")).toMatchObject({
        title: "en two",
        views: 11,
      });
      expect(await published(entries, id, "es")).toMatchObject({
        title: "es one",
        views: 11,
      });
    }, 120_000);

    it("restores a Spanish version into Spanish's draft only, leaving English and every public read", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      const spanishFirst = await newestVersion("collection", TRANSLATED, id);
      await save(entries, id, "es", { title: "es two", status: "published" });
      await save(entries, id, "en", { title: "en draft" });

      const res = await post(restorePath(id, spanishFirst));
      expect(res.status, await res.clone().text()).toBe(200);

      const stored = await drafts(id);
      expect(stored.es?.title).toBe("es one");
      // English's own pending edit is untouched, and holds nothing Spanish.
      expect(stored.en?.title).toBe("en draft");
      // Public reads serve what is published, in both languages.
      expect(await published(entries, id, "es")).toMatchObject({
        title: "es two",
      });
      expect(await published(entries, id, "en")).toMatchObject({
        title: "en one",
      });
    }, 120_000);

    it("keeps the shared draft when restoring a version that was never published", async () => {
      const entries = await boot(dialect);
      // Saved as a draft first: this version was never published.
      const created = await entries.createEntry(
        { collectionName: TRANSLATED, overrideAccess: true, locale: "en" },
        { title: "en first draft", body: "en body", views: 5, status: "draft" }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = (created.data as { id: string }).id;
      const neverPublished = await newestVersion("collection", TRANSLATED, id);
      // Then published in both languages, with a pending shared edit on top.
      await save(entries, id, "en", {
        title: "en one",
        views: 10,
        status: "published",
      });
      await save(entries, id, "es", {
        title: "es one",
        body: "es body",
        status: "published",
      });
      await save(entries, id, "en", { views: 20 });

      const res = await post(restorePath(id, neverPublished), {
        fields: ["title"],
      });
      expect(res.status, await res.clone().text()).toBe(200);

      const stored = await drafts(id);
      expect(stored.en?.title).toBe("en first draft");
      // The pending shared edit is still there...
      expect(stored.shared?.views).toBe(20);
      // ...and the document is still published as it was: a restore of a
      // draft version puts no draft status on what readers see.
      expect(await published(entries, id, "en")).toMatchObject({
        title: "en one",
        views: 10,
        status: "published",
      });
    }, 120_000);

    it("restores only the fields it is asked for", async () => {
      const entries = await boot(dialect);
      const id = await publishedInBoth(entries);
      const first = await newestVersion("collection", TRANSLATED, id);
      await save(entries, id, "es", {
        title: "es two",
        body: "es body two",
        views: 30,
        status: "published",
      });

      const res = await post(restorePath(id, first), { fields: ["title"] });
      expect(res.status, await res.clone().text()).toBe(200);

      const stored = await drafts(id);
      expect(stored.es?.title).toBe("es one");
      // Not asked for: neither the other translatable field nor the shared one.
      expect(stored.es?.body ?? "es body two").toBe("es body two");
      expect(stored.shared).toBeUndefined();
    }, 120_000);

    it("refuses a restore where a collection keeps no drafts, and changes nothing", async () => {
      await boot(dialect);
      const handler = handle!.getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      const created = await handler.createEntry(
        { collectionName: HISTORY_ONLY, overrideAccess: true },
        { title: "First" }
      );
      const id = (created.data as { id: string }).id;
      await handler.updateEntry(
        { collectionName: HISTORY_ONLY, entryId: id, overrideAccess: true },
        { title: "Second", _overwrite: true }
      );
      const before = await newestVersion("collection", HISTORY_ONLY, id);

      const res = await post(
        `collections/${HISTORY_ONLY}/entries/${id}/versions/1/restore`
      );
      expect(res.status).toBe(422);
      const after = await handler.getEntry({
        collectionName: HISTORY_ONLY,
        entryId: id,
        overrideAccess: true,
      });
      expect((after.data as { title?: string }).title).toBe("Second");
      expect(await newestVersion("collection", HISTORY_ONLY, id)).toBe(before);
    }, 120_000);

    it("refuses a restore where a Single keeps no drafts, and changes nothing", async () => {
      await boot(dialect);
      const nextly = handle!.nextly;
      await nextly.updateSingle({
        slug: HISTORY_ONLY_SINGLE,
        data: { headline: "First", _overwrite: true },
      });
      await nextly.updateSingle({
        slug: HISTORY_ONLY_SINGLE,
        data: { headline: "Second", _overwrite: true },
      });

      const res = await post(
        `singles/${HISTORY_ONLY_SINGLE}/versions/1/restore`
      );
      expect(res.status).toBe(422);
      const after = (await nextly.findSingle({
        slug: HISTORY_ONLY_SINGLE,
      })) as {
        headline?: string;
      };
      expect(after.headline).toBe("Second");
    }, 120_000);
  }
);

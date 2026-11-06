/**
 * An update must say which version of the document it changes (`_rev`), or
 * that it sets the document whatever is stored (`_overwrite: true`). One that
 * says neither is refused with `VERSION_REQUIRED` (428), names both remedies,
 * and changes nothing, on every door and every write that is judged by
 * version: an entry or a Single, one item of a batch, the same values to many
 * documents, publishing or unpublishing every language, taking the live
 * values, discarding a pending change and restoring a version.
 *
 * Trusted server code is refused like anyone: the only writes not asked are a
 * release run's own (see `release-run-not-judged`), creates, deletes and
 * autosave. Setup writes here choose `_overwrite`, since they are not what is
 * under test.
 *
 * @module route-handler/__tests__/version-required.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, defineSingle, number, text } from "../../config";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import type { CollectionService } from "../../domains/collections/services/collection-service";
import { definePlugin } from "../../plugins/plugin-context";
import type { PluginRouteContext } from "../../plugins/routes/route-types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { CollectionsHandler } from "../../services/collections-handler";

/** A plain collection. */
const NOTES = "vr_notes";
/** Translated, with a status every language can be moved to at once. */
const PAGES = "vr_pages";
/**
 * Translated, with a status and a field every language shares, so a
 * published entry holds an edit as a pending change, and a language's
 * pending change can take the live shared values.
 */
const ARTICLES = "vr_articles";
/** With content history, so a version can be restored. */
const LOGGED = "vr_logged";
const SETTINGS = "vr_settings";
const BANNER = "vr_banner";

let services: PluginRouteContext["services"]["collections"] | undefined;

const probe = definePlugin({
  name: "version-required-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    services = ctx.services.collections;
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    plugins: [probe],
    collections: [
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
      defineCollection({
        slug: PAGES,
        localized: true,
        status: true,
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: ARTICLES,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" }), number({ name: "articleCount" })],
      }),
      defineCollection({
        slug: LOGGED,
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({ slug: SETTINGS, fields: [text({ name: "notice" })] }),
      defineSingle({
        slug: BANNER,
        localized: true,
        status: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

type Doc = Record<string, unknown>;

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

const serviceOf = (t: TestNextly): CollectionService =>
  t.getService("collectionService") as unknown as CollectionService;

const docOf = (answer: unknown): Doc => {
  const value = answer as { item?: Doc; data?: Doc } & Doc;
  return value.item ?? value.data ?? value;
};

async function create(t: TestNextly, slug: string, data: Doc): Promise<string> {
  const made = docOf(
    await t.nextly.create({ collection: slug as never, data } as never)
  );
  return String(made.id);
}

/** A setup write: whatever is stored, since it is not what is under test. */
async function setUp(
  t: TestNextly,
  slug: string,
  id: string,
  data: Doc,
  locale?: string
): Promise<void> {
  await t.nextly.update({
    collection: slug as never,
    id,
    data: { ...data, _overwrite: true },
    ...(locale ? { locale } : {}),
  } as never);
}

/** A super-admin's full-access key: every route here takes a signed-in caller. */
async function adminKey(t: TestNextly): Promise<string> {
  const admin = await superAdminUser(t, "user-vr-admin");
  const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "version-required",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

/** One REST call with the key: its status and its JSON. */
async function rest(
  key: string,
  method: "POST" | "PATCH" | "DELETE",
  path: string[],
  body?: Doc,
  query = ""
): Promise<{ status: number; json: Doc }> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

const errorOf = (json: Doc) =>
  (json.error ?? {}) as { code?: string; message?: string; data?: Doc };

/** The REST refusal every door answers an update with neither key with. */
function expectVersionRequired(answer: { status: number; json: Doc }) {
  expect(answer.status, JSON.stringify(answer.json)).toBe(428);
  const error = errorOf(answer.json);
  expect(error.code).toBe("VERSION_REQUIRED");
  expect(error.message).toContain("`_rev`");
  expect(error.message).toContain("`_overwrite: true`");
  expect(error.data).toMatchObject({
    versionKey: "_rev",
    overwriteKey: "_overwrite",
  });
}

/** The code a thrown refusal, or a refused service answer, carries. */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    const answer = (await call()) as { success?: boolean; code?: string };
    return answer?.success === false ? String(answer.code) : "applied";
  } catch (error) {
    return String((error as { code?: unknown }).code);
  }
}

/** `who`'s call on the document lock route, signed in: its status and JSON. */
async function lockCall(
  who: string,
  method: "POST" | "PATCH",
  body: Doc
): Promise<{ status: number; json: Doc }> {
  const token = await signAccessToken(
    buildClaims({
      userId: who,
      email: `${who}@example.test`,
      name: who,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  const res = await createDynamicHandlers()[method](
    new Request("http://localhost/api/document-lock", {
      method,
      headers: {
        origin: "http://localhost",
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: ["document-lock"] }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

/** A stored entry, read raw: the oracle for what was written. */
async function stored(t: TestNextly, slug: string, id: string): Promise<Doc> {
  const read = await handlerOf(t).getEntry({
    collectionName: slug,
    entryId: id,
    overrideAccess: true,
  });
  return (read as { data: Doc }).data;
}

async function storedSingle(t: TestNextly, slug: string): Promise<Doc> {
  return docOf(
    await t.nextly.findSingle({
      slug: slug as never,
      overrideAccess: true,
    } as never)
  );
}

/** The version a read of `locale` gives, `*` for every language. */
async function readRev(
  t: TestNextly,
  slug: string,
  id: string,
  locale?: string
): Promise<string> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id,
    ...(locale ? { locale } : {}),
    overrideAccess: true,
    status: "all",
  } as never)) as Doc | null;
  if (typeof doc?._rev !== "string") throw new Error(`no _rev for ${id}`);
  return doc._rev;
}

describe.each(getConfiguredTestDialects())(
  "an update that says neither which version it changes nor to overwrite (%s)",
  dialect => {
    it("is refused on every door, naming both remedies, and changes nothing", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await create(t, NOTES, { title: "first" });

      expectVersionRequired(
        await rest(key, "PATCH", ["collections", NOTES, "entries", id], {
          title: "by REST",
        })
      );
      // Trusted server code is asked like anyone.
      expect(
        await codeOf(() =>
          t.nextly.update({
            collection: NOTES as never,
            id,
            data: { title: "by Direct" },
            overrideAccess: true,
          } as never)
        )
      ).toBe("VERSION_REQUIRED");
      expect(
        await codeOf(() =>
          services!.updateEntry(
            NOTES,
            id,
            { title: "by plugin" },
            { as: "system" }
          )
        )
      ).toBe("VERSION_REQUIRED");
      expect((await stored(t, NOTES, id)).title).toBe("first");

      // Either remedy is applied.
      const read = await rest(
        key,
        "PATCH",
        ["collections", NOTES, "entries", id],
        { title: "from the read", _rev: await readRev(t, NOTES, id) }
      );
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      const overwritten = await rest(
        key,
        "PATCH",
        ["collections", NOTES, "entries", id],
        { title: "overwritten", _overwrite: true }
      );
      expect(overwritten.status, JSON.stringify(overwritten.json)).toBe(200);
      expect((await stored(t, NOTES, id)).title).toBe("overwritten");
    });

    it("refuses a Single's update the same way", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      await t.nextly.updateSingle({
        slug: SETTINGS as never,
        data: { notice: "first", _overwrite: true },
      } as never);

      expectVersionRequired(
        await rest(key, "PATCH", ["singles", SETTINGS], { notice: "by REST" })
      );
      expect(
        await codeOf(() =>
          t.nextly.updateSingle({
            slug: SETTINGS as never,
            data: { notice: "by Direct" },
          } as never)
        )
      ).toBe("VERSION_REQUIRED");
      expect((await storedSingle(t, SETTINGS)).notice).toBe("first");

      const overwritten = await rest(key, "PATCH", ["singles", SETTINGS], {
        notice: "overwritten",
        _overwrite: true,
      });
      expect(overwritten.status, JSON.stringify(overwritten.json)).toBe(200);
      expect((await storedSingle(t, SETTINGS)).notice).toBe("overwritten");
    });

    it("refuses the one item of a batch that gives neither, and applies the rest", async () => {
      const t = await boot(dialect);
      const a = await create(t, NOTES, { title: "a" });
      const b = await create(t, NOTES, { title: "b" });

      const batch = await serviceOf(t).updateMany(
        NOTES,
        [
          { id: a, data: { title: "a2", _rev: await readRev(t, NOTES, a) } },
          { id: b, data: { title: "b2" } },
        ],
        { overrideAccess: true } as never
      );

      expect(batch.errors.map(error => error.code)).toEqual([
        "VERSION_REQUIRED",
      ]);
      expect((await stored(t, NOTES, a)).title).toBe("a2");
      expect((await stored(t, NOTES, b)).title).toBe("b");
    });

    it("refuses the same values to many documents whole, by ids and by query, writing none", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const ids = [
        await create(t, NOTES, { title: "a" }),
        await create(t, NOTES, { title: "b" }),
      ];

      const byIds = await rest(
        key,
        "POST",
        ["collections", NOTES, "entries", "bulk-update"],
        { ids, data: { title: "bulk" } }
      );
      expect(byIds.status, JSON.stringify(byIds.json)).toBe(428);
      expect(errorOf(byIds.json).code).toBe("VERSION_REQUIRED");
      expect(errorOf(byIds.json).data).toMatchObject({ revsKey: "revs" });

      expect(
        await codeOf(() =>
          t.nextly.update({
            collection: NOTES as never,
            where: { id: { in: ids } },
            data: { title: "by query" },
          } as never)
        )
      ).toBe("VERSION_REQUIRED");
      for (const id of ids) {
        expect(["a", "b"]).toContain((await stored(t, NOTES, id)).title);
      }

      // A version for each id, or the overwrite choice, is applied.
      const revs = Object.fromEntries(
        await Promise.all(
          ids.map(async id => [id, await readRev(t, NOTES, id)])
        )
      );
      const withRevs = await rest(
        key,
        "POST",
        ["collections", NOTES, "entries", "bulk-update"],
        { ids, data: { title: "with revs" }, revs }
      );
      expect(withRevs.status, JSON.stringify(withRevs.json)).toBe(200);
      const overwritten = await rest(
        key,
        "POST",
        ["collections", NOTES, "entries", "bulk-update"],
        { ids, data: { title: "overwritten", _overwrite: true } }
      );
      expect(overwritten.status, JSON.stringify(overwritten.json)).toBe(200);
      for (const id of ids) {
        expect((await stored(t, NOTES, id)).title).toBe("overwritten");
      }
    });

    it("refuses publishing and unpublishing every language of an entry and a Single", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await create(t, PAGES, { title: "en" });
      await setUp(t, PAGES, id, { title: "es" }, "es");
      await t.nextly.updateSingle({
        slug: BANNER as never,
        data: { headline: "en", _overwrite: true },
      } as never);

      for (const route of ["publish-all", "unpublish-all"]) {
        expectVersionRequired(
          await rest(
            key,
            "POST",
            ["collections", PAGES, "entries", id, route],
            {}
          )
        );
      }
      // A Single moves every language through its publish only.
      expectVersionRequired(
        await rest(key, "POST", ["singles", BANNER, "publish-all"], {})
      );
      expect((await stored(t, PAGES, id)).status).toBe("draft");

      const published = await rest(
        key,
        "POST",
        ["collections", PAGES, "entries", id, "publish-all"],
        { _overwrite: true }
      );
      expect(published.status, JSON.stringify(published.json)).toBe(200);
      const banner = await rest(
        key,
        "POST",
        ["singles", BANNER, "publish-all"],
        {
          _overwrite: true,
        }
      );
      expect(banner.status, JSON.stringify(banner.json)).toBe(200);
    });

    it("refuses taking the live values into a pending change, and discarding it", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const made = await handlerOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "en", articleCount: 10, status: "published" }
      );
      const id = String((made.data as Doc).id);
      // Both languages live, then a status-less save of each is held as its
      // pending change, the Spanish one moving the shared count.
      await setUp(t, ARTICLES, id, { title: "es", status: "published" }, "es");
      await setUp(t, ARTICLES, id, { title: "en edited" }, "en");
      await setUp(t, ARTICLES, id, { articleCount: 13 }, "es");
      const draft = [
        "collections",
        ARTICLES,
        "entries",
        id,
        "versions",
        "working-draft",
      ];

      expectVersionRequired(
        await rest(key, "POST", [...draft, "take-live"], {}, "?locale=en")
      );
      expectVersionRequired(
        await rest(key, "DELETE", draft, undefined, "?locale=en")
      );

      const discarded = await rest(
        key,
        "DELETE",
        draft,
        undefined,
        "?locale=en&_overwrite=true"
      );
      expect(discarded.status, JSON.stringify(discarded.json)).toBe(200);
    });

    it("refuses restoring a version", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await create(t, LOGGED, { title: "one" });
      await setUp(t, LOGGED, id, { title: "two" });
      const restore = [
        "collections",
        LOGGED,
        "entries",
        id,
        "versions",
        "1",
        "restore",
      ];

      expectVersionRequired(await rest(key, "POST", restore, {}));
      expect((await stored(t, LOGGED, id)).title).toBe("two");

      const restored = await rest(key, "POST", restore, { _overwrite: true });
      expect(restored.status, JSON.stringify(restored.json)).toBe(200);
      expect((await stored(t, LOGGED, id)).title).toBe("one");
    });

    // A release run's own write is the one not asked, and only the runner can
    // say so: nothing a caller sends, in its data or its options, makes a
    // write one.
    it("lets no caller mark its write as a release run's", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const id = await create(t, NOTES, { title: "first" });
      const claim = {
        scopeKind: "collection",
        scopeSlug: NOTES,
        entryId: id,
      };

      expect(
        await codeOf(() =>
          t.nextly.update({
            collection: NOTES as never,
            id,
            data: { title: "claimed", releaseRun: claim, _releaseRun: true },
            context: { releaseRun: claim },
          } as never)
        )
      ).toBe("VERSION_REQUIRED");
      expectVersionRequired(
        await rest(key, "PATCH", ["collections", NOTES, "entries", id], {
          title: "claimed",
          releaseRun: claim,
          _releaseRun: true,
        })
      );
      expect((await stored(t, NOTES, id)).title).toBe("first");
    });

    // Access is a precondition: a caller who may not update here is refused
    // for that, whatever the body says, before it is asked for a version.
    it("refuses an update by query from a caller who may not update as forbidden, before asking for a version", async () => {
      const t = await boot(dialect);
      const reader = await userWhoMay(t, "user-vr-reader", "read", [NOTES]);
      const writer = await userWhoMay(t, "user-vr-writer", "update", [NOTES]);
      await grantTo(t, writer, "read", [NOTES]);
      const id = await create(t, NOTES, { title: "a" });
      const byQuery = (user: string, data: Doc) =>
        codeOf(() =>
          t.nextly.update({
            collection: NOTES as never,
            where: { id: { equals: id } },
            data,
            overrideAccess: false,
            user: { id: user },
          } as never)
        );

      expect(await byQuery(reader, { title: "b" })).toBe("FORBIDDEN");
      expect(await byQuery(reader, { title: "b", _overwrite: true })).toBe(
        "FORBIDDEN"
      );
      // One who may update is still asked for a version.
      expect(await byQuery(writer, { title: "b" })).toBe("VERSION_REQUIRED");
      expect((await stored(t, NOTES, id)).title).toBe("a");
    });

    // A lock claim or renewal may name the version the editor holds, and is
    // decoded as an update's would be, but it writes no document: one that
    // names none is answered as before, while an update naming none is not.
    it("still answers a lock claim and renewal that name no version", async () => {
      const t = await boot(dialect);
      const key = await adminKey(t);
      const editor = "user-vr-editor";
      await userWhoMay(t, editor, "update", [NOTES]);
      await grantTo(t, editor, "read", [NOTES]);
      const id = await create(t, NOTES, { title: "first" });
      const ref = { scopeKind: "collection", slug: NOTES, entryId: id };

      const claim = await lockCall(editor, "POST", ref);
      expect(claim.status, JSON.stringify(claim.json)).toBe(200);
      const held = claim.json.item as Doc;
      expect(held.status).toBe("acquired");
      const renewal = await lockCall(editor, "PATCH", {
        ...ref,
        claimToken: held.claimToken,
      });
      expect(renewal.status, JSON.stringify(renewal.json)).toBe(200);

      expectVersionRequired(
        await rest(key, "PATCH", ["collections", NOTES, "entries", id], {
          title: "unsaid",
        })
      );
    });

    it("leaves creates and deletes as they were", async () => {
      const t = await boot(dialect);
      const id = await create(t, NOTES, { title: "made" });
      await t.nextly.delete({ collection: NOTES as never, id } as never);
      expect(
        await handlerOf(t).getEntry({
          collectionName: NOTES,
          entryId: id,
          overrideAccess: true,
        })
      ).toMatchObject({ success: false });
    });
  }
);

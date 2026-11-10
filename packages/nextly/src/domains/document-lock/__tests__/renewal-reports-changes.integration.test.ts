/**
 * A claim or renewal that names the version the editor's copy started from
 * says whether someone else has changed the document since.
 *
 * The heartbeat is the one call a holder already makes on an interval, so it
 * carries the editor's `_rev` and its answer carries `changed` when the parts
 * that version covers (the document's own row and the editor's language) have
 * moved. The change is described exactly as a refused save describes it: the
 * current version always, who and when only to a caller who may read the
 * document. A take-back is a claim, so it is told the same way.
 *
 * Driven through the REST lock route, as the admin drives it, on every
 * dialect.
 *
 * @module domains/document-lock/__tests__/renewal-reports-changes.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

// Integration files share fixed system-table names, so this file keeps its
// own slugs.
const POSTS = "lockchg_posts";
const BANNER = "lockchg_banner";
/** The holder: may read and update both documents. */
const EDITOR = "lockchg-editor";
/** A holder who may update the posts but not read them. */
const WRITER = "lockchg-writer";
/** The colleague whose save the holder is told about. */
const ANA = {
  id: "lockchg-ana",
  name: "Ana Ruiz",
  email: "ana-lockchg@x.test",
};
const ORIGIN = "http://localhost";

type Doc = Record<string, unknown>;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "note" }),
        ],
      }),
    ],
    singles: [
      defineSingle({ slug: BANNER, fields: [text({ name: "notice" })] }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  current = t;
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(t.adapter.dialect).toBe(dialect);
  await userWhoMay(t, EDITOR, "update", [POSTS, BANNER]);
  await grantTo(t, EDITOR, "read", [POSTS, BANNER]);
  await userWhoMay(t, WRITER, "update", [POSTS]);
  const now = new Date();
  await t.adapter.insert("users", {
    ...ANA,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return t;
}

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A post with a translation in each language. */
async function post(t: TestNextly): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: POSTS, overrideAccess: true, locale: "en" },
    { title: "hello", note: "shared" }
  );
  const id = String((created.data as Doc).id);
  await handlerOf(t).updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true, locale: "es" },
    { title: "hola", _overwrite: true }
  );
  return id;
}

/** The post's version as the editor's form reads it, in `locale`. */
async function readRev(t: TestNextly, id: string, locale: string) {
  const read = (await t.nextly.findByID({
    collection: POSTS as never,
    id,
    locale,
    overrideAccess: true,
  } as never)) as Doc;
  return String(read._rev);
}

/** Ana saves `data` on the post, in `locale`, from the version she just read. */
async function anaSaves(
  t: TestNextly,
  id: string,
  locale: string,
  data: Doc
): Promise<void> {
  await handlerOf(t).updateEntry(
    {
      collectionName: POSTS,
      entryId: id,
      overrideAccess: true,
      locale,
      user: ANA as never,
    },
    { ...data, _rev: await readRev(t, id, locale) }
  );
}

/** `who`'s REST call on the lock route: its status and envelope. */
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
  const segments = ["document-lock"];
  const res = await createDynamicHandlers()[method](
    new Request(`${ORIGIN}/api/${segments.join("/")}`, {
      method,
      headers: {
        origin: ORIGIN,
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  return { status: res.status, json: (await res.json()) as Doc };
}

/** The answer's item, failing loudly on anything but a 200. */
async function itemOf(
  call: Promise<{ status: number; json: Doc }>
): Promise<Doc> {
  const { status, json } = await call;
  expect(status, JSON.stringify(json)).toBe(200);
  return json.item as Doc;
}

const postRef = (id: string) => ({
  scopeKind: "collection",
  slug: POSTS,
  entryId: id,
});

/** `who` claims the post, holding the version `rev`: their claim token. */
async function claimed(who: string, id: string, rev?: string) {
  const item = await itemOf(
    lockCall(who, "POST", { ...postRef(id), ...(rev ? { _rev: rev } : {}) })
  );
  expect(item.status).toBe("acquired");
  return String(item.claimToken);
}

describe.each(getConfiguredTestDialects())(
  "a lock that names the version the editor holds (%s)",
  dialect => {
    it("a renewal after someone else's save reports the new version and who saved", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");
      const claimToken = await claimed(EDITOR, id, startedFrom);
      const before = Date.now();

      await anaSaves(t, id, "en", { note: "Ana's change" });
      const item = await itemOf(
        lockCall(EDITOR, "PATCH", {
          ...postRef(id),
          claimToken,
          _rev: startedFrom,
        })
      );

      expect(item.status).toBe("renewed");
      expect(item.changed).toMatchObject({
        currentVersion: await readRev(t, id, "en"),
        changedBy: { kind: "person", name: ANA.name },
      });
      const at = Date.parse(String((item.changed as Doc).changedAt));
      expect(at).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      // Told as a refusal is told: never a value, an email or an id.
      const told = JSON.stringify(item.changed);
      expect(told).not.toContain("Ana's change");
      expect(told).not.toContain(ANA.email);
      expect(told).not.toContain(ANA.id);
    });

    it("reports nothing to a renewal that holds the current version", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const claimToken = await claimed(EDITOR, id);
      await anaSaves(t, id, "en", { note: "Ana's change" });

      const item = await itemOf(
        lockCall(EDITOR, "PATCH", {
          ...postRef(id),
          claimToken,
          _rev: await readRev(t, id, "en"),
        })
      );
      expect(item.status).toBe("renewed");
      expect(item).not.toHaveProperty("changed");
    });

    it("reports nothing to a renewal that names no version, as before", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const claimToken = await claimed(EDITOR, id);
      await anaSaves(t, id, "en", { note: "Ana's change" });

      const item = await itemOf(
        lockCall(EDITOR, "PATCH", { ...postRef(id), claimToken })
      );
      expect(item.status).toBe("renewed");
      expect(item).not.toHaveProperty("changed");
    });

    it("does not count a change to another language", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");
      const claimToken = await claimed(EDITOR, id, startedFrom);

      await anaSaves(t, id, "es", { title: "otra" });
      const item = await itemOf(
        lockCall(EDITOR, "PATCH", {
          ...postRef(id),
          claimToken,
          _rev: startedFrom,
        })
      );
      expect(item).not.toHaveProperty("changed");
    });

    it("tells a claim that takes the document back what changed while its holder was away", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");
      await claimed(EDITOR, id, startedFrom);
      await anaSaves(t, id, "en", { note: "Ana's change" });

      const item = await itemOf(
        lockCall(EDITOR, "POST", {
          ...postRef(id),
          takeover: true,
          _rev: startedFrom,
        })
      );
      expect(item.status).toBe("acquired");
      expect(item.changed).toMatchObject({
        currentVersion: await readRev(t, id, "en"),
        changedBy: { kind: "person", name: ANA.name },
      });
    });

    it("tells a holder who may update but not read the version only", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const startedFrom = await readRev(t, id, "en");
      const claimToken = await claimed(WRITER, id, startedFrom);
      await anaSaves(t, id, "en", { note: "Ana's change" });

      const item = await itemOf(
        lockCall(WRITER, "PATCH", {
          ...postRef(id),
          claimToken,
          _rev: startedFrom,
        })
      );
      expect(item.changed).toEqual({
        currentVersion: await readRev(t, id, "en"),
      });
    });

    it("refuses a version that is not one, as a save refuses it", async () => {
      const t = await boot(dialect);
      const id = await post(t);
      const claimToken = await claimed(EDITOR, id);

      const { status, json } = await lockCall(EDITOR, "PATCH", {
        ...postRef(id),
        claimToken,
        _rev: "not-a-version",
      });
      expect(status).toBe(400);
      expect(json).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    });

    it("reports someone else's change to a Single's holder", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as SingleEntryService;
      const first = (await singles.update(
        BANNER,
        { notice: "first", _overwrite: true },
        { overrideAccess: true }
      )) as { data?: Doc };
      const id = String(first.data?.id);
      const startedFrom = String(first.data?._rev);
      const ref = { scopeKind: "single", slug: BANNER, entryId: id };
      const claim = await itemOf(
        lockCall(EDITOR, "POST", { ...ref, _rev: startedFrom })
      );
      await singles.update(
        BANNER,
        { notice: "Ana's notice", _rev: startedFrom },
        { overrideAccess: true, user: ANA as never }
      );

      const item = await itemOf(
        lockCall(EDITOR, "PATCH", {
          ...ref,
          claimToken: claim.claimToken,
          _rev: startedFrom,
        })
      );
      expect(item.changed).toMatchObject({
        changedBy: { kind: "person", name: ANA.name },
      });
    });
  }
);

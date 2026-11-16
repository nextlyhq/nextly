/**
 * An update made from an out-of-date version of a Single is refused; one made
 * from the current version, or with none, is applied.
 *
 * The oracle throughout is the stored row, read raw: a refused save leaves it
 * as it was.
 *
 * @module domains/singles/__tests__/stale-version.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Two languages, with a shared field. */
const PREFS = "prefs";
let prefsBeforeChangeCalls = 0;
/** No languages; counts its before-change hook's runs. */
const PLAIN = "plain";
let beforeChangeCalls = 0;
/** Two languages, each with its own status. */
const LIVE = "live";
/** Readable only by AUTHOR, by its read rule; both people may update it. */
const AUTHORS_ONLY = "authors_only";
const AUTHOR = "single-author";
const OTHER = "single-other";
const ANA = {
  id: "user-ana",
  name: "Ana Ruiz",
  email: "ana@x.test",
  role: "admin",
};

const OPEN = { read: () => true, update: () => true };

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: PREFS,
        localized: true,
        access: OPEN,
        hooks: {
          beforeChange: [
            ({ data }: { data?: unknown }) => {
              prefsBeforeChangeCalls += 1;
              return data;
            },
          ],
        },
        fields: [
          text({ name: "siteName", localized: true }),
          text({ name: "contact", localized: false }),
        ],
      }),
      defineSingle({
        slug: PLAIN,
        access: OPEN,
        hooks: {
          beforeChange: [
            ({ data }: { data?: unknown }) => {
              beforeChangeCalls += 1;
              return data;
            },
          ],
        },
        fields: [text({ name: "notice" })],
      }),
      defineSingle({
        slug: AUTHORS_ONLY,
        access: {
          read: ({ user }: { user: { id: string } | null }) =>
            user?.id === AUTHOR,
          update: () => true,
        },
        fields: [text({ name: "notice" })],
      }),
      defineSingle({
        slug: LIVE,
        localized: true,
        status: true,
        access: { ...OPEN, publish: () => true, unpublish: () => true },
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite proves nothing.
  expect(current.adapter.dialect).toBe(dialect);
  const now = new Date();
  await current.adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  // A code rule only narrows a permission, so both people hold each one.
  for (const person of [AUTHOR, OTHER]) {
    await userWhoMay(current, person, "read", [AUTHORS_ONLY]);
    await grantTo(current, person, "update", [AUTHORS_ONLY]);
  }
  return current;
}

type Result = {
  success?: boolean;
  statusCode?: number;
  code?: string;
  data?: Record<string, unknown> | null;
  publicData?: Record<string, unknown>;
};

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

const save = (
  t: TestNextly,
  slug: string,
  data: Record<string, unknown>,
  options: { locale?: string; user?: typeof ANA } = {}
): Promise<Result> =>
  singlesOf(t).update(slug, data, {
    overrideAccess: true,
    ...options,
  } as never) as Promise<Result>;

const read = async (
  t: TestNextly,
  slug: string,
  locale?: string
): Promise<string> => {
  const result = (await singlesOf(t).get(slug, {
    overrideAccess: true,
    ...(locale ? { locale } : {}),
  } as never)) as Result;
  const rev = result.data?._rev;
  if (typeof rev !== "string")
    throw new Error(`no _rev on ${JSON.stringify(result)}`);
  return rev;
};

function revOf(result: Result): string {
  const rev = result.data?._rev;
  if (typeof rev !== "string")
    throw new Error(`no _rev on ${JSON.stringify(result)}`);
  return rev;
}

async function mainRow(
  t: TestNextly,
  slug: string
): Promise<Record<string, unknown>> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    `single_${slug}`,
    {}
  );
  if (rows.length !== 1) throw new Error(`${rows.length} rows for ${slug}`);
  return rows[0];
}

describe.each(getConfiguredTestDialects())(
  "judging a Single's update by the version it gives (%s)",
  dialect => {
    it("applies the first save from the version a read of the unsaved Single gave", async () => {
      const t = await boot(dialect);
      const version = await read(t, PLAIN);
      const first = await save(t, PLAIN, { notice: "first", _rev: version });
      expect(first.success, JSON.stringify(first)).toBe(true);
      expect((await mainRow(t, PLAIN)).notice).toBe("first");
    });

    it("refuses a save from a version someone else's save replaced, and leaves it as it was", async () => {
      const t = await boot(dialect);
      const first = await save(t, PLAIN, { notice: "first", _overwrite: true });
      const version = revOf(first);
      const theirs = await save(
        t,
        PLAIN,
        { notice: "theirs", _rev: version },
        { user: ANA }
      );
      expect(theirs.success, JSON.stringify(theirs)).toBe(true);

      const mine = await save(t, PLAIN, { notice: "mine", _rev: version });
      expect(mine).toMatchObject({
        success: false,
        statusCode: 409,
        code: "STALE_VERSION",
      });
      expect(mine.publicData).toMatchObject({
        currentVersion: revOf(theirs),
        changedBy: { kind: "person", name: ANA.name },
      });
      expect(JSON.stringify(mine)).not.toContain("theirs");
      expect((await mainRow(t, PLAIN)).notice).toBe("theirs");
    });

    it("applies a save from the current version, and refuses one that gives none", async () => {
      const t = await boot(dialect);
      const first = await save(t, PLAIN, { notice: "first", _overwrite: true });
      const second = await save(t, PLAIN, {
        notice: "second",
        _rev: revOf(first),
      });
      expect(second.success, JSON.stringify(second)).toBe(true);
      const unjudged = await save(t, PLAIN, { notice: "third" });
      expect(unjudged, JSON.stringify(unjudged)).toMatchObject({
        success: false,
        statusCode: 428,
        code: "VERSION_REQUIRED",
      });
      expect((await mainRow(t, PLAIN)).notice).toBe("second");
    });

    it("refuses with 400 a version that is not one, and an _overwrite that is not true or false", async () => {
      const t = await boot(dialect);
      await save(t, PLAIN, { notice: "first", _overwrite: true });
      for (const data of [
        { _rev: "seven" },
        { _rev: 7 },
        { _overwrite: "yes" },
      ]) {
        const result = await save(t, PLAIN, { notice: "no", ...data });
        expect(result, JSON.stringify(data)).toMatchObject({
          success: false,
          statusCode: 400,
        });
      }
      const overwritten = await save(t, PLAIN, {
        notice: "over",
        _overwrite: true,
      });
      expect(overwritten.success, JSON.stringify(overwritten)).toBe(true);
      expect(await mainRow(t, PLAIN)).not.toHaveProperty("_overwrite");
    });

    it("judges a translated save on its own language and the shared fields", async () => {
      const t = await boot(dialect);
      await save(
        t,
        PREFS,
        { siteName: "Hello", contact: "c", _overwrite: true },
        { locale: "en" }
      );
      const es = await save(
        t,
        PREFS,
        { siteName: "Hola", _overwrite: true },
        { locale: "es" }
      );
      const readEs = revOf(es);

      // English changes: the Spanish version is still current.
      await save(
        t,
        PREFS,
        { siteName: "Hello again", _overwrite: true },
        { locale: "en" }
      );
      const fine = await save(
        t,
        PREFS,
        { siteName: "Hola otra vez", _rev: readEs },
        { locale: "es" }
      );
      expect(fine.success, JSON.stringify(fine)).toBe(true);

      // Spanish changes: a Spanish save from before it is out of date.
      const stale = await save(
        t,
        PREFS,
        { siteName: "Adios", _rev: readEs },
        { locale: "es" }
      );
      expect(stale).toMatchObject({
        success: false,
        statusCode: 409,
        code: "STALE_VERSION",
      });
      expect(stale.publicData).toMatchObject({ currentVersion: revOf(fine) });

      // A shared field changes: every language's save from before it is out of date.
      await save(
        t,
        PREFS,
        { contact: "shared", _overwrite: true },
        { locale: "en" }
      );
      const afterShared = await save(
        t,
        PREFS,
        { siteName: "Otra", _rev: revOf(fine) },
        { locale: "es" }
      );
      expect(afterShared).toMatchObject({
        success: false,
        statusCode: 409,
        code: "STALE_VERSION",
      });
      expect(await read(t, PREFS, "es")).toBe(
        `${(await mainRow(t, PREFS))._revision}.es:2`
      );
    });

    it("refuses a version below the stored one before any hook runs", async () => {
      const t = await boot(dialect);
      const first = await save(t, PLAIN, { notice: "first", _overwrite: true });
      await save(t, PLAIN, { notice: "theirs", _overwrite: true });
      const before = beforeChangeCalls;
      expect(before).toBeGreaterThan(0);
      const refused = await save(t, PLAIN, {
        notice: "mine",
        _rev: revOf(first),
      });
      expect(refused).toMatchObject({ code: "STALE_VERSION" });
      expect(beforeChangeCalls).toBe(before);
    });

    it("answers a refused translated save with a version that names its language, which that save may then send", async () => {
      const t = await boot(dialect);
      await save(
        t,
        PREFS,
        { siteName: "Hello", contact: "c", _overwrite: true },
        { locale: "en" }
      );
      const es = await save(
        t,
        PREFS,
        { siteName: "Hola", _overwrite: true },
        { locale: "es" }
      );
      await save(
        t,
        PREFS,
        { contact: "shared", _overwrite: true },
        { locale: "en" }
      );
      const refused = await save(
        t,
        PREFS,
        { siteName: "Otra", _rev: revOf(es) },
        { locale: "es" }
      );
      expect(refused).toMatchObject({ code: "STALE_VERSION" });
      const current = String(refused.publicData?.currentVersion);
      expect(current).toBe(await read(t, PREFS, "es"));
      const again = await save(
        t,
        PREFS,
        { siteName: "Otra", _rev: current },
        { locale: "es" }
      );
      expect(again.success, JSON.stringify(again)).toBe(true);
    });

    it("refuses a status sweep of every language when any language moved since its version", async () => {
      const t = await boot(dialect);
      await save(
        t,
        LIVE,
        { headline: "Hi", status: "published", _overwrite: true },
        { locale: "en" }
      );
      await save(
        t,
        LIVE,
        { headline: "Hola", status: "published", _overwrite: true },
        { locale: "es" }
      );
      const everyLanguage = await read(t, LIVE, "*");
      // Spanish alone changes after the read.
      await save(
        t,
        LIVE,
        { headline: "Hola de nuevo", _overwrite: true },
        { locale: "es" }
      );
      const swept = await save(
        t,
        LIVE,
        { status: "draft", _rev: everyLanguage },
        { locale: "*" }
      );
      expect(swept).toMatchObject({ success: false, code: "STALE_VERSION" });
      expect(String(swept.publicData?.currentVersion)).toBe(
        await read(t, LIVE, "*")
      );
      const fresh = await save(
        t,
        LIVE,
        { status: "draft", _rev: await read(t, LIVE, "*") },
        { locale: "*" }
      );
      expect(fresh.success, JSON.stringify(fresh)).toBe(true);
    });

    it("refuses a save whose translation is already behind before any hook runs", async () => {
      const t = await boot(dialect);
      await save(
        t,
        PREFS,
        { siteName: "Hello", contact: "c", _overwrite: true },
        { locale: "en" }
      );
      const es = await save(
        t,
        PREFS,
        { siteName: "Hola", _overwrite: true },
        { locale: "es" }
      );
      await save(
        t,
        PREFS,
        { siteName: "Hola otra vez", _overwrite: true },
        { locale: "es" }
      );
      const before = prefsBeforeChangeCalls;
      const refused = await save(
        t,
        PREFS,
        { siteName: "Mía", _rev: revOf(es) },
        { locale: "es" }
      );
      expect(refused).toMatchObject({ code: "STALE_VERSION" });
      expect(prefsBeforeChangeCalls).toBe(before);
    });

    it("refuses with 400 a sweep of every language whose version names only one", async () => {
      const t = await boot(dialect);
      await save(
        t,
        LIVE,
        { headline: "Hi", status: "published", _overwrite: true },
        { locale: "en" }
      );
      await save(
        t,
        LIVE,
        { headline: "Hola", status: "published", _overwrite: true },
        { locale: "es" }
      );
      const english = await read(t, LIVE, "en");
      const swept = await save(
        t,
        LIVE,
        { status: "draft", _rev: english },
        { locale: "*" }
      );
      expect(swept).toMatchObject({ success: false, statusCode: 400 });
    });

    it("tells who changed it and when only to a caller its read rule lets read it", async () => {
      const t = await boot(dialect);
      const first = await save(t, AUTHORS_ONLY, {
        notice: "first",
        _overwrite: true,
      });
      await save(t, AUTHORS_ONLY, { notice: "theirs", _overwrite: true });
      const refusalTo = (userId: string) =>
        singlesOf(t).update(
          AUTHORS_ONLY,
          { notice: "mine", _rev: revOf(first) },
          { overrideAccess: false, user: { id: userId } } as never
        ) as Promise<Result>;
      const author = await refusalTo(AUTHOR);
      expect(author, JSON.stringify(author)).toMatchObject({
        code: "STALE_VERSION",
      });
      expect(author.publicData).toHaveProperty("changedBy");
      const other = await refusalTo(OTHER);
      expect(other, JSON.stringify(other)).toMatchObject({
        code: "STALE_VERSION",
      });
      expect(other.publicData).not.toHaveProperty("changedBy");
      expect(other.publicData).not.toHaveProperty("changedAt");
    });
  }
);

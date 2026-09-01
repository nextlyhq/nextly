/**
 * What the wildcard locale refuses.
 *
 * The sweep it performs moves companion rows that the ordinary transition tests
 * cannot see — they ask whether THIS write moves the main row or the write
 * locale's companion, and a document already at the target status in both
 * answers no while every other translation still moves. So the two guards here
 * are not belt-and-braces: without them the wildcard is a way to perform a
 * lifecycle change that the lifecycle gate never judged.
 *
 * @module domains/collections/__tests__/wildcard-locale-contract.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "guarded";
const NO_LIFECYCLE_SLUG = "plainrows";
const SINGLE_SLUG = "prefs";
const DRAFTS_SLUG = "drafted";
const NO_LIFECYCLE_SINGLE = "plainprefs";

/** An editor who may update, and may publish, but may NOT take anything down. */
const EDITOR = { id: "editor-1", isActive: true };

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          // The one capability under test.
          unpublish: () => false,
        },
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: DRAFTS_SLUG,
        localized: true,
        status: true,
        // The split: a status-less save is held as that language's pending edit.
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: NO_LIFECYCLE_SLUG,
        // No `status: true`, so no lifecycle — and an ordinary user field that
        // happens to be CALLED status, which is what makes the wildcard look
        // like a valid status-only patch while being a plain field write.
        access: { read: () => true, update: () => true },
        fields: [text({ name: "status" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: NO_LIFECYCLE_SINGLE,
        // No lifecycle, and an ordinary field named `status`.
        access: { read: () => true, update: () => true },
        fields: [text({ name: "status" })],
      }),
      defineSingle({
        slug: SINGLE_SLUG,
        localized: true,
        status: true,
        // The split: a status-less save is held as that language's pending
        // change instead of touching the live row.
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "siteName", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const singlesOf = (t: TestNextly): SingleEntryService =>
  t.getService("singleEntryService");

/** The LIVE translated value for one language, read raw. */
async function liveSiteName(
  t: TestNextly,
  locale: string
): Promise<string | undefined> {
  const row = await t.adapter.selectOne<{ site_name?: string }>(
    `single_${SINGLE_SLUG}_locales`,
    { where: { and: [{ column: "_locale", op: "=", value: locale }] } }
  );
  return row?.site_name;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

async function companionStatuses(
  t: TestNextly,
  table: string
): Promise<Record<string, string>> {
  const rows = await t.adapter.select<{ _locale?: unknown; _status?: unknown }>(
    table,
    {}
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[String(r._locale)] = String(r._status);
  return out;
}

/**
 * The document the guard exists for: main row and the DEFAULT language already
 * draft, one translation still published.
 *
 * Reaching that state needs the per-locale path, which is the honest way to it —
 * an editor took English down and never touched German.
 */
async function germanStillLive(t: TestNextly): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "Page EN", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");

  await handlerOf(t).updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "de" },
    { title: "Seite DE", status: "published" }
  );
  // English down, German left alone — done with full authority, so this setup
  // is not itself the thing under test.
  await handlerOf(t).updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true },
    { status: "draft" }
  );
  return id;
}

describe.each(getConfiguredTestDialects())(
  "the wildcard locale's contract (%s)",
  dialect => {
    it("REFUSES a wildcard takedown from a caller who may not unpublish", async () => {
      const t = await boot(dialect);
      const id = await germanStillLive(t);

      // Precondition, and the whole point: the two transition tests the ordinary
      // gate performs both answer "no move" here, because main and `en` are
      // already draft. Only `de` is going to move.
      const before = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(before.en).toBe("draft");
      expect(before.de).toBe("published");

      const refused = await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: false,
          user: EDITOR,
          locale: "*",
        },
        { status: "draft" }
      );

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(403);
      // The German translation is still live: the refusal rolled the sweep back
      // rather than denying after the fact.
      const after = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(after.de).toBe("published");
    });

    it("CONTROL: the same caller may still perform a wildcard publish", async () => {
      // Proves the refusal above is the `unpublish` rule and not the wildcard
      // being refused for everyone — without this, a wildcard that rejected
      // every caller would pass the case above.
      const t = await boot(dialect);
      const id = await germanStillLive(t);

      const allowed = await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: false,
          user: EDITOR,
          locale: "*",
        },
        { status: "published" }
      );

      expect(allowed.success).toBe(true);
      const after = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(after.en).toBe("published");
      expect(after.de).toBe("published");
    });

    it("REFUSES rather than decide the fate of unreleased work (Single)", async () => {
      // A pending edit records the whole document as it looked when it was
      // saved, not the fields its author touched — so two languages' edits
      // cannot be merged without inventing a rule for which shared value wins,
      // and every such rule discards somebody's work in some ordering. The
      // wildcard therefore refuses and names the languages holding work, so a
      // scheduled release stops where an operator can see it.
      const t = await boot(dialect);
      const singles = singlesOf(t);
      await singles.update(
        SINGLE_SLUG,
        { siteName: "EN v1", status: "published" },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        SINGLE_SLUG,
        { siteName: "DE v1", status: "published" },
        { locale: "de", overrideAccess: true }
      );
      // A status-less save in the NON-write language is held as pending.
      await singles.update(
        SINGLE_SLUG,
        { siteName: "DE v2" },
        { locale: "de", overrideAccess: true }
      );

      // Precondition: the edit really is pending, not live.
      expect(await liveSiteName(t, "de")).toBe("DE v1");

      const refused = await singles.update(
        SINGLE_SLUG,
        { status: "published" },
        { locale: "*", overrideAccess: true }
      );

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(409);
      expect(refused.message).toContain("de");
      // Nothing moved: the refusal is a precondition, not a rollback.
      expect(await liveSiteName(t, "de")).toBe("DE v1");
    });

    it("CONTROL: the wildcard still runs when nothing is being held", async () => {
      // Without this, a wildcard that refused unconditionally would satisfy the
      // case above while breaking every ordinary release.
      const t = await boot(dialect);
      const singles = singlesOf(t);
      await singles.update(
        SINGLE_SLUG,
        { siteName: "EN v1", status: "draft" },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        SINGLE_SLUG,
        { siteName: "DE v1", status: "draft" },
        { locale: "de", overrideAccess: true }
      );

      const ok = await singles.update(
        SINGLE_SLUG,
        { status: "published" },
        { locale: "*", overrideAccess: true }
      );

      expect(ok.success).toBe(true);
      const after = await companionStatuses(t, `single_${SINGLE_SLUG}_locales`);
      expect(after.en).toBe("published");
      expect(after.de).toBe("published");
    });

    it("emits one lifecycle event per language the sweep moved", async () => {
      // Without this a scheduled German publish produces no `locale`-tagged
      // event, so webhook-driven indexing never learns the translation went live
      // and goes stale while the release reports success. Strapi's document
      // service fires its lifecycle hooks once per locale for exactly this
      // operation; Payload carries an open defect for firing only on the active
      // one. Per locale is the expected shape, not an embellishment.
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "Page EN", status: "draft" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "Seite DE", status: "draft" }
      );

      const before = await companionStatuses(t, `dc_${SLUG}_locales`);
      expect(before.de).toBe("draft");

      // In-process workflow subscribers, which are a different audience from the
      // durable outbox and were equally blind to a swept language.
      // The subscriber receives an ENVELOPE, so the locale is one level in; a
      // read of the top level finds `undefined` for every event and reports the
      // replay as missing when it fired correctly.
      const published: unknown[] = [];
      t.events.on("document.published", (event: unknown) => {
        published.push(
          (event as { payload?: { locale?: unknown } })?.payload?.locale
        );
      });

      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published" }
      );

      // Population control first: no listener firing at all would satisfy a
      // filter over an empty list.
      expect(published.length).toBeGreaterThan(0);
      expect(published).toContain("de");

      const rows = await t.adapter.select<{
        type?: string;
        payload?: unknown;
      }>("nextly_events", {});
      // The locale lives on the envelope's `resource`, not on a column — a
      // filter over the flattened columns finds nothing and reads as "no event
      // was emitted", which is the answer this test exists to distinguish from.
      const germanEvents = rows.filter(r => {
        const payload = (
          typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload
        ) as { resource?: Record<string, unknown> } | undefined;
        return (
          payload?.resource?.locale === "de" && payload?.resource?.id === id
        );
      });

      // The German transition is reported, tagged with the language it belongs
      // to. Asserted on membership rather than a count: an unrelated event for
      // another locale would satisfy a total.
      // Population control: an empty table would satisfy any filter, and this
      // test's whole subject is a filter that finds nothing.
      expect(rows.length).toBeGreaterThan(0);
      expect(germanEvents.length).toBeGreaterThan(0);
      expect(germanEvents.map(e => e.type)).toContain("entry.published");
    });

    it("does not date a first publication for a document already live elsewhere", async () => {
      // A Single can sit with a draft main row beside a translation that has
      // been live since before this column existed. The main row's own
      // transition then reads as a first publication for a document the public
      // could already reach, and dating it today records a publication that
      // never happened.
      const t = await boot(dialect);
      const singles = singlesOf(t);
      // German live, main row left alone: a non-default-locale write keeps its
      // lifecycle on the companion.
      await singles.update(
        SINGLE_SLUG,
        { siteName: "DE live", status: "published" },
        { locale: "de", overrideAccess: true }
      );

      const beforeRow = await t.adapter.selectOne<{
        status?: string;
        first_published_at?: unknown;
      }>(`single_${SINGLE_SLUG}`, {});
      // Preconditions: the document IS already public in one language, and no
      // first publication has ever been recorded. Without both, the assertion
      // below passes for reasons that have nothing to do with the rule.
      expect(beforeRow?.status).not.toBe("published");
      expect(beforeRow?.first_published_at ?? null).toBeNull();
      const statuses = await companionStatuses(
        t,
        `single_${SINGLE_SLUG}_locales`
      );
      expect(statuses.de).toBe("published");

      await singles.update(
        SINGLE_SLUG,
        { status: "published" },
        { locale: "*", overrideAccess: true }
      );

      const afterRow = await t.adapter.selectOne<{
        first_published_at?: unknown;
      }>(`single_${SINGLE_SLUG}`, {});
      expect(afterRow?.first_published_at ?? null).toBeNull();
    });

    it("REFUSES rather than decide the fate of unreleased work (collection)", async () => {
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: DRAFTS_SLUG, overrideAccess: true },
        { title: "EN v1", status: "published" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      await handlerOf(t).updateEntry(
        {
          collectionName: DRAFTS_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "DE v1", status: "published" }
      );
      // Held in the non-write language.
      await handlerOf(t).updateEntry(
        {
          collectionName: DRAFTS_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "de",
        },
        { title: "DE v2" }
      );

      const liveTitle = async (locale: string): Promise<string | undefined> => {
        const row = await t.adapter.selectOne<{ title?: string }>(
          `dc_${DRAFTS_SLUG}_locales`,
          { where: { and: [{ column: "_locale", op: "=", value: locale }] } }
        );
        return row?.title;
      };
      expect(await liveTitle("de")).toBe("DE v1");

      const refused = await handlerOf(t).updateEntry(
        {
          collectionName: DRAFTS_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published" }
      );

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(409);
      expect(refused.message).toContain("de");
      expect(await liveTitle("de")).toBe("DE v1");
    });

    it("REFUSES the wildcard on a Single with no lifecycle to move", async () => {
      const t = await boot(dialect);
      await singlesOf(t).update(
        NO_LIFECYCLE_SINGLE,
        { status: "keep me" },
        { overrideAccess: true }
      );

      const refused = await singlesOf(t).update(
        NO_LIFECYCLE_SINGLE,
        { status: "overwritten" },
        { locale: "*", overrideAccess: true }
      );

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(400);
      const row = await t.adapter.selectOne<{ status?: string }>(
        `single_${NO_LIFECYCLE_SINGLE}`,
        {}
      );
      expect(row?.status).toBe("keep me");
    });

    it("emits a lifecycle event for each Single language the sweep moved", async () => {
      const t = await boot(dialect);
      const singles = singlesOf(t);
      await singles.update(
        SINGLE_SLUG,
        { siteName: "EN", status: "draft" },
        { locale: "en", overrideAccess: true }
      );
      await singles.update(
        SINGLE_SLUG,
        { siteName: "DE", status: "draft" },
        { locale: "de", overrideAccess: true }
      );

      await singles.update(
        SINGLE_SLUG,
        { status: "published" },
        { locale: "*", overrideAccess: true }
      );

      const rows = await t.adapter.select<{ type?: string; payload?: unknown }>(
        "nextly_events",
        {}
      );
      expect(rows.length).toBeGreaterThan(0);
      const german = rows.filter(r => {
        const payload = (
          typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload
        ) as { resource?: Record<string, unknown> } | undefined;
        return payload?.resource?.locale === "de";
      });
      expect(german.map(e => e.type)).toContain("single.published");
    });

    it("REFUSES the wildcard on a collection with no lifecycle to move", async () => {
      // A collection whose `status` is an ordinary field has the column and no
      // lifecycle. Admitting the wildcard there would write that field on the
      // default locale — a field write, which is what the wildcard refuses.
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: NO_LIFECYCLE_SLUG, overrideAccess: true },
        { status: "keep me" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");

      const refused = await handlerOf(t).updateEntry(
        {
          collectionName: NO_LIFECYCLE_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "overwritten" }
      );

      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(400);
      const row = await t.adapter.selectOne<{ status?: string }>(
        `dc_${NO_LIFECYCLE_SLUG}`,
        { where: { and: [{ column: "id", op: "=", value: id }] } }
      );
      expect(row?.status).toBe("keep me");
    });
  }
);

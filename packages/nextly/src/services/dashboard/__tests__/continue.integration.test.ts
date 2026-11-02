/**
 * Continue where you left off, from the reader's pins and the activity trail,
 * through a booted instance on every dialect.
 *
 * What only a booted instance shows: the real write paths record what makes a
 * save a save (a publish marks its row, a held edit is recorded as the edit it
 * is, a Single names the fields it changed), and the card's source reads them
 * back one row per document, across every collection the reader may read and
 * no cap on how many, as that reader, each titled as they read it now: Mine
 * with their pins first, Team with everyone else's saves. A reader who has
 * saved nothing (Cleo) reads every save on Team, which is how the trail's own
 * cases are asked here.
 *
 * @module services/dashboard/__tests__/continue.integration.test
 */

import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  refreshEndpointPresence,
  setWebhookAuditEnabled,
} from "../../../domains/webhooks/recording-activation";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import type { WidgetQuery } from "../../../domains/widgets/query";
import type { WidgetResult } from "../../../domains/widgets/result";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../readable-resources";
import { CONTINUE_SOURCE_ID } from "../continue-widget-source";
import { dashboardPinsService } from "../dashboard-pins-service";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const NOTES = "re_notes";
const PAGES = "re_pages";
const SECRET = "re_secret";
/** A collection whose read rule refuses whoever a test names, between two reads. */
const GATED = "re_gated";
const HOME = "re-home";
/** A Single with Draft/Published, saved but never published. */
const ABOUT = "re-about";
/** A Single that holds an edit of its live page as a draft, with a component of two sub-fields. */
const LANDING = "re-landing";
/** More collections than the cross-collection read it replaces ever looked at. */
const MANY = Array.from({ length: 22 }, (_, i) => `re_c${i}`);

const ANA = { id: "re-ana", name: "Ana", email: "ana@re.test" };
const BEN = { id: "re-ben", name: "Ben", email: "ben@re.test" };
/** The one person `SECRET`'s rule lets read it. */
const BOSS = { id: "re-boss", name: "Boss", email: "boss@re.test" };
/** A reader who saves nothing, so Team shows her every save she may read. */
const CLEO = { id: "re-cleo", name: "Cleo", email: "cleo@re.test" };

/** Readers `GATED`'s rule refuses, changed by a test. */
const refused = new Set<string>();

const T0 = Date.parse("2026-10-23T12:00:00Z");
/** `minutes` before T0. */
const at = (minutes: number) => new Date(T0 - minutes * 60_000);

let current: TestNextly | undefined;

afterEach(async () => {
  refused.clear();
  await current?.destroy();
  current = undefined;
});

const card = () =>
  defineFieldGroup({ slug: "re_card", fields: [text({ name: "caption" })] });
const banner = () =>
  defineFieldGroup({
    slug: "re_banner",
    fields: [text({ name: "heading" }), text({ name: "subheading" })],
  });

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    fieldGroups: [card(), banner()],
    collections: [
      defineCollection({
        slug: NOTES,
        // Draft/Published, without versions: an edit writes the live row.
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: PAGES,
        // With versions: an edit to a published page is held as a draft.
        status: true,
        versions: true,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: GATED,
        access: {
          read: ({ user }: { user?: { id?: string } | null }) =>
            !refused.has(user?.id ?? ""),
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: SECRET,
        access: {
          read: ({ user }: { user?: { id?: string } | null }) =>
            user?.id === BOSS.id,
        },
        fields: [text({ name: "title" })],
      }),
      ...MANY.map(slug =>
        defineCollection({
          slug,
          access: { read: () => true },
          fields: [text({ name: "title" })],
        })
      ),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        label: { singular: "Home" },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "hero", component: "re_card" }),
        ],
      }),
      defineSingle({
        slug: ABOUT,
        label: { singular: "About" },
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: LANDING,
        label: { singular: "Landing" },
        status: true,
        versions: true,
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "hero", component: "re_banner" }),
        ],
      }),
    ],
  });
  current = t;
  for (const person of [ANA, BEN, BOSS, CLEO]) {
    await t.adapter.insert("users", { ...person, is_active: true });
    // A code rule only narrows the permission, so each reader holds read on
    // every collection and Single here and the rules decide what they see.
    await grantTo(t, person.id, "read", [
      NOTES,
      PAGES,
      SECRET,
      GATED,
      ...MANY,
      HOME,
      ABOUT,
    ]);
  }
  return t;
}

/** A collection whose entries are written in each of the site's languages. */
const INTL = "re_intl";

/**
 * A site in English and French with one localized collection, its title
 * per language: apart from `boot`, so no other case runs on a localized site.
 */
async function bootLocalized(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: INTL,
        localized: true,
        access: { read: () => true },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    localization: { locales: ["en", "fr"], defaultLocale: "en" },
  });
  current = t;
  for (const person of [ANA, CLEO]) {
    await t.adapter.insert("users", { ...person, is_active: true });
    await grantTo(t, person.id, "read", [INTL]);
  }
  return t;
}

interface TrailRow {
  id: string;
  action: string;
  collection: string;
  entryId: string | null;
  metadata: string | Record<string, unknown> | null;
}

const trail = (t: TestNextly) => t.adapter.select<TrailRow>("activity_log");

/**
 * Runs `write`, then gives every row it added to the trail the instant `when`,
 * so the rows' order is the cases' own: on MySQL and SQLite, writes in one
 * second would otherwise tie, broken by a random id.
 */
async function written(
  t: TestNextly,
  when: Date,
  write: () => Promise<unknown>
): Promise<TrailRow[]> {
  const before = new Set((await trail(t)).map(row => row.id));
  await write();
  const added = (await trail(t)).filter(row => !before.has(row.id));
  for (const row of added) {
    await t.adapter.update(
      "activity_log",
      { created_at: when },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
  return added;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ data: unknown }>;
    updateEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<unknown>;
  };
}

/** The write context of `person` saving in `collection`, as the admin's own writes carry it. */
const asPerson = (person: typeof ANA, collection: string) => ({
  collectionName: collection,
  overrideAccess: true,
  user: { id: person.id, email: person.email },
  actor: { type: "user", id: person.id },
});

async function create(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  data: Record<string, unknown>,
  when: Date
): Promise<string> {
  let id = "";
  await written(t, when, async () => {
    const created = await handlerOf(t).createEntry(
      asPerson(person, collection),
      data
    );
    id = (created.data as { id: string }).id;
  });
  return id;
}

function save(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  entryId: string,
  data: Record<string, unknown>,
  when: Date
) {
  return written(t, when, () =>
    handlerOf(t).updateEntry({ ...asPerson(person, collection), entryId }, data)
  );
}

const as = (person: { id: string }): ReadCaller => ({
  user: { id: person.id, roles: [] },
});

/** The card's answer for `caller` on `tab`, whole, as the batch hands it on. */
function asked(
  caller: ReadCaller,
  tab: "mine" | "team",
  query: Partial<WidgetQuery> = {}
): Promise<WidgetResult> {
  return executeWidgetQuery(
    {
      source: CONTINUE_SOURCE_ID,
      op: "list",
      limit: 25,
      where: { tab },
      ...query,
    },
    caller
  );
}

/** The rows of the card for `caller` on `tab`. */
async function rowsOf(
  caller: ReadCaller,
  tab: "mine" | "team"
): Promise<Record<string, unknown>[]> {
  const answer = await asked(caller, tab);
  return answer.op === "list" ? answer.items : [];
}

/** Every save but the reader's, newest first: Team. */
const team = (caller: ReadCaller) => rowsOf(caller, "team");
/** The reader's pins, then their own saves: Mine. */
const mine = (caller: ReadCaller) => rowsOf(caller, "mine");

const metadataOf = (row: TrailRow): Record<string, unknown> =>
  typeof row.metadata === "string"
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : (row.metadata ?? {});

describe.each(getConfiguredTestDialects())(
  "Continue where you left off (integration, %s)",
  dialect => {
    it("lists the latest save of each document across more than twenty collections, newest first", async () => {
      const t = await boot(dialect);
      const ids: string[] = [];
      for (const [i, slug] of MANY.entries()) {
        ids.push(await create(t, ANA, slug, { title: `Doc ${i}` }, at(i + 1)));
      }

      const rows = await team(as(CLEO));
      // 🔴 Every one of the twenty-two: the read it replaces stopped at twenty
      // collections, so the oldest two never appeared.
      expect(rows.map(row => row.entryId)).toEqual(ids);
      expect(rows[0]).toMatchObject({
        entryTitle: "Doc 0",
        collection: MANY[0],
        userId: ANA.id,
        userName: ANA.name,
        status: null,
      });
    });

    it("shows a document saved three times once, at its latest save", async () => {
      const t = await boot(dialect);
      const id = await create(t, ANA, NOTES, { title: "one" }, at(10));
      await save(t, ANA, NOTES, id, { title: "two" }, at(5));
      const [latest] = await save(t, BEN, NOTES, id, { title: "three" }, at(1));

      const rows = await team(as(CLEO));
      expect(rows.map(row => [row.entryId, row.id, row.userId])).toEqual([
        [id, latest!.id, BEN.id],
      ]);
      expect(rows[0]).toMatchObject({ entryTitle: "three", status: "draft" });
    });

    it("keeps the editor's save when someone else only publishes it, and labels it published", async () => {
      const t = await boot(dialect);
      const id = await create(t, ANA, NOTES, { title: "draft" }, at(10));
      const [edit] = await save(t, ANA, NOTES, id, { title: "edited" }, at(5));
      // A publish on its own: the status and the write's own stamps change.
      await save(t, BEN, NOTES, id, { status: "published" }, at(1));

      const rows = await team(as(CLEO));
      expect(rows.map(row => [row.id, row.userId, row.status])).toEqual([
        [edit!.id, ANA.id, "published"],
      ]);
      expect(rows[0]?.editedAt).toBe(at(5).toISOString());
    });

    it("shows a held edit of a published page as changes not published, until a promotion puts it live", async () => {
      const t = await boot(dialect);
      const id = await create(
        t,
        BEN,
        PAGES,
        { title: "live", status: "published" },
        at(10)
      );
      // No `status`: held as a working draft on the published page.
      const [held] = await save(t, ANA, PAGES, id, { title: "pending" }, at(5));

      const pending = await team(as(CLEO));
      expect(pending.map(row => [row.id, row.userId])).toEqual([
        [held!.id, ANA.id],
      ]);
      expect(pending[0]).toMatchObject({
        status: "published",
        pendingChanges: true,
      });

      // Ben publishes Ana's pending edits. The status stays published, so only
      // the row's mark says it was a publish.
      const [promotion] = await save(
        t,
        BEN,
        PAGES,
        id,
        { status: "published" },
        at(1)
      );
      expect(metadataOf(promotion!)).toMatchObject({ published: true });

      const live = await team(as(CLEO));
      // 🔴 Still Ana's save at its own time: the promotion published her edits
      // and made none of its own.
      expect(live.map(row => [row.id, row.userId])).toEqual([
        [held!.id, ANA.id],
      ]);
      expect(live[0]).toMatchObject({
        status: "published",
        pendingChanges: false,
      });
    });

    it("takes the publisher's row when the publish also edits the page", async () => {
      const t = await boot(dialect);
      const id = await create(
        t,
        BEN,
        PAGES,
        { title: "live", status: "published" },
        at(10)
      );
      await save(t, ANA, PAGES, id, { title: "pending" }, at(5));

      // 🔴 Ben publishes Ana's pending edits AND changes the title in the same
      // request. That title was never saved before, so the publish is a save of
      // Ben's; the pure promotion above is the case that keeps Ana's row.
      const [publish] = await save(
        t,
        BEN,
        PAGES,
        id,
        { status: "published", title: "edited on publish" },
        at(1)
      );
      expect(metadataOf(publish!)).toMatchObject({
        published: true,
        publishedWithEdits: true,
      });
      expect((await team(as(CLEO))).map(row => [row.id, row.userId])).toEqual([
        [publish!.id, BEN.id],
      ]);
    });

    it("keeps the editor's row when the publish only echoes the draft back", async () => {
      const t = await boot(dialect);
      const id = await create(
        t,
        BEN,
        PAGES,
        { title: "live", status: "published" },
        at(10)
      );
      const [held] = await save(t, ANA, PAGES, id, { title: "pending" }, at(5));

      // 🔴 Ben sends the draft's own title and the page's id with the publish:
      // nothing he sent changes what is promoted, so the save stays Ana's.
      const [publish] = await save(
        t,
        BEN,
        PAGES,
        id,
        { status: "published", title: "pending", id },
        at(1)
      );
      expect(metadataOf(publish!)).toMatchObject({ published: true });
      expect(metadataOf(publish!)).not.toHaveProperty("publishedWithEdits");
      expect((await team(as(CLEO))).map(row => [row.id, row.userId])).toEqual([
        [held!.id, ANA.id],
      ]);
    });

    it("labels a Single saved as a draft with its status", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update: (
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ) => Promise<{ success: boolean }>;
      };
      await written(t, at(1), () =>
        singles.update(
          ABOUT,
          { headline: "Draft words" },
          { overrideAccess: true, actor: { type: "user", id: ANA.id } }
        )
      );
      // Read as the reader, in every state: a draft is read, not reported
      // missing, so its row says "draft" rather than nothing.
      expect(
        (await team(as(CLEO))).map(row => [row.collection, row.status])
      ).toEqual([[ABOUT, "draft"]]);
    });

    it("keeps the editor's row when a Single's publish sends part of the draft's component back, and takes the publisher's when the part differs", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update: (
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ) => Promise<{ success: boolean }>;
      };
      const by = (person: typeof ANA) => ({
        overrideAccess: true,
        actor: { type: "user", id: person.id },
      });
      await written(t, at(30), () =>
        singles.update(
          LANDING,
          {
            headline: "Live",
            hero: { heading: "Live", subheading: "Sub" },
            status: "published",
          },
          by(BEN)
        )
      );
      // No `status`: held as a draft of the live page.
      await written(t, at(20), () =>
        singles.update(
          LANDING,
          { hero: { heading: "Pending", subheading: "Sub" } },
          by(ANA)
        )
      );

      // 🔴 Ben publishes, sending one sub-field of the draft's component as
      // the draft holds it. Compared as the fragment sent, it lacks the
      // other sub-field and reads as an edit; merged, as it is written, it is
      // the draft's own component.
      const [echo] = await written(t, at(10), () =>
        singles.update(
          LANDING,
          { status: "published", hero: { heading: "Pending" } },
          by(BEN)
        )
      );
      expect(metadataOf(echo!)).toMatchObject({ published: true });
      expect(metadataOf(echo!)).not.toHaveProperty("publishedWithEdits");

      // The must-differ half: a part the draft does not hold is an edit.
      await written(t, at(5), () =>
        singles.update(
          LANDING,
          { hero: { heading: "Again", subheading: "Sub" } },
          by(ANA)
        )
      );
      const [edit] = await written(t, at(1), () =>
        singles.update(
          LANDING,
          { status: "published", hero: { heading: "Ben's" } },
          by(BEN)
        )
      );
      expect(metadataOf(edit!)).toMatchObject({
        published: true,
        publishedWithEdits: true,
      });
    });

    it("fills the card from older readable saves when the newest are all of a collection the reader may not read", async () => {
      const t = await boot(dialect);
      const readable = await create(t, ANA, NOTES, { title: "mine" }, at(500));
      const secret = await create(t, BEN, SECRET, { title: "hush" }, at(400));
      // More than one page of the walk, every one a save Ana may not read.
      await t.adapter.insertMany(
        "activity_log",
        Array.from({ length: 150 }, (_, i) => ({
          id: randomUUID(),
          actor_type: "user",
          user_id: BEN.id,
          user_name: BEN.name,
          user_email: BEN.email,
          action: "update",
          collection: SECRET,
          entry_id: secret,
          entry_title: "hush",
          subject_kind: "collection",
          metadata: JSON.stringify({ changedFields: ["title", "updatedAt"] }),
          created_at: new Date(T0 - i * 1_000),
        }))
      );

      expect((await team(as(CLEO))).map(row => row.entryId)).toEqual([
        readable,
      ]);
      // The control: the reader the rule lets in sees the secret first.
      expect((await team(as(BOSS))).map(row => row.entryId)).toEqual([
        secret,
        readable,
      ]);
    });

    it("puts the reader's own saves on Mine and everyone else's on Team, and never takes a key's save for a person's", async () => {
      const t = await boot(dialect);
      const anas = await create(t, ANA, NOTES, { title: "Ana's" }, at(30));
      const bens = await create(t, BEN, NOTES, { title: "Ben's" }, at(20));
      const other = await create(
        t,
        ANA,
        MANY[0]!,
        { title: "Elsewhere" },
        at(10)
      );
      // A key whose id is the same string as Ana's, saving Ben's note last.
      await t.getService("activityLogService").logActivity({
        actorType: "apiKey",
        userId: ANA.id,
        action: "update",
        collection: NOTES,
        entryId: bens,
        entryTitle: "Ben's",
        subjectKind: "collection",
        metadata: { changedFields: ["title"] },
      });

      expect((await mine(as(ANA))).map(row => row.entryId)).toEqual([
        other,
        anas,
      ]);
      // 🔴 The key's save of Ben's note is the latest that is not Ana's own,
      // however its id compares with hers.
      expect(
        (await team(as(ANA))).map(row => [row.entryId, row.actorType])
      ).toEqual([[bens, "apiKey"]]);
    });

    it("names the fields a Single's save changed, a component's included, with neither webhooks nor audit on", async () => {
      const t = await boot(dialect);
      // The harness turns audit on so outbox tests do not depend on endpoints;
      // this one is about the install where neither is on, and no endpoint
      // exists, so the presence read answers no.
      setWebhookAuditEnabled(false);
      await refreshEndpointPresence();
      const singles = t.getService("singleEntryService") as unknown as {
        update: (
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ) => Promise<{ success: boolean }>;
      };
      const actor = {
        overrideAccess: true,
        actor: { type: "user", id: ANA.id },
      };
      expect(
        (await singles.update(HOME, { headline: "Hi" }, actor)).success
      ).toBe(true);
      const outboxBefore = (await t.adapter.select("nextly_events")).length;
      // The control: with neither on, the first save recorded nothing either,
      // so an unchanged count below is the gate holding, not a count that
      // could not have moved.
      expect(outboxBefore).toBe(0);

      const [row] = await written(t, at(1), () =>
        singles.update(HOME, { hero: { caption: "New caption" } }, actor)
      );

      // 🔴 A component-only edit: compared as raw rows it changes nothing, as
      // the component lives in its own table.
      const changed = metadataOf(row!).changedFields;
      expect(changed).toContain("hero");
      expect(changed).not.toContain("headline");
      // The documents were assembled for the trail alone: no webhook payload
      // reached the outbox on an install with neither webhooks nor audit.
      expect((await t.adapter.select("nextly_events")).length).toBe(
        outboxBefore
      );
      expect(
        (await team(as(CLEO))).map(edit => [edit.subjectKind, edit.collection])
      ).toEqual([["single", HOME]]);
    });

    it("lists Mine's pins first and the reader's saves after, and Team's saves by others, each entry once", async () => {
      const t = await boot(dialect);
      // Saved three times by Ana: one row on her Mine.
      const own = await create(t, ANA, NOTES, { title: "Own" }, at(30));
      await save(t, ANA, NOTES, own, { title: "Own two" }, at(25));
      await save(t, ANA, NOTES, own, { title: "Own three" }, at(20));
      // Ben's, pinned by Ana.
      const pinned = await create(t, BEN, NOTES, { title: "Pinned" }, at(15));
      // Ben's, saved twice: one row on Ana's Team.
      const bens = await create(t, BEN, NOTES, { title: "Ben's" }, at(10));
      await save(t, BEN, NOTES, bens, { title: "Ben's two" }, at(5));
      await dashboardPinsService().pin(as(ANA), {
        targetType: "collection",
        targetSlug: NOTES,
        entryId: pinned,
      });

      const ownRows = await mine(as(ANA));
      expect(ownRows.map(row => [row.entryId, row.pinned])).toEqual([
        [pinned, true],
        [own, false],
      ]);
      expect(ownRows[1]).toMatchObject({ entryTitle: "Own three" });

      const others = await team(as(ANA));
      expect(
        others.map(row => [row.entryId, row.userName, row.pinned])
      ).toEqual([
        [bens, BEN.name, false],
        [pinned, BEN.name, true],
      ]);
      // Each entry once on each tab.
      for (const rows of [ownRows, others]) {
        const ids = rows.map(row => row.entryId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it("leaves out, title and all, an entry the reader may no longer read, and one that is deleted", async () => {
      const t = await boot(dialect);
      const gated = await create(
        t,
        ANA,
        GATED,
        { title: "Gated plan" },
        at(20)
      );
      const doomed = await create(t, ANA, NOTES, { title: "Doomed" }, at(10));
      await dashboardPinsService().pin(as(BEN), {
        targetType: "collection",
        targetSlug: GATED,
        entryId: gated,
      });

      // The control: before the change, Ben reads both, and his pin.
      expect((await team(as(BEN))).map(row => row.entryId)).toEqual([
        doomed,
        gated,
      ]);
      expect((await mine(as(BEN))).map(row => row.entryId)).toEqual([gated]);

      refused.add(BEN.id);
      await t.nextly.delete({ collection: NOTES, id: doomed });

      // 🔴 Neither row, nor its title anywhere in the answer, on either tab.
      for (const tab of ["team", "mine"] as const) {
        const answer = await asked(as(BEN), tab);
        expect(answer.op === "list" ? answer.items : null).toEqual([]);
        expect(JSON.stringify(answer)).not.toContain("Gated plan");
        expect(JSON.stringify(answer)).not.toContain("Doomed");
      }
      // Cleo may still read the gated entry; the deleted one is gone for her too.
      expect((await team(as(CLEO))).map(row => row.entryTitle)).toEqual([
        "Gated plan",
      ]);
      // Ben's pin is kept, so it returns with his access.
      refused.delete(BEN.id);
      expect((await mine(as(BEN))).map(row => row.entryId)).toEqual([gated]);
    });

    it("titles a save made in another language in that language, as the row links to it", async () => {
      const t = await bootLocalized(dialect);
      const id = await create(t, ANA, INTL, { title: "Title EN" }, at(10));
      await written(t, at(5), () =>
        handlerOf(t).updateEntry(
          { ...asPerson(ANA, INTL), entryId: id, locale: "fr" },
          { title: "Titre FR" }
        )
      );
      // Ana's latest save of it, recorded in French: the row this case reads.
      await t.adapter.insert("activity_log", {
        id: randomUUID(),
        actor_type: "user",
        user_id: ANA.id,
        user_name: ANA.name,
        user_email: ANA.email,
        action: "update",
        collection: INTL,
        entry_id: id,
        entry_title: "Titre FR",
        subject_kind: "collection",
        locale: "fr",
        metadata: JSON.stringify({ changedFields: ["title"] }),
        created_at: new Date(T0),
      });

      const answer = await asked(as(CLEO), "team");
      const rows = answer.op === "list" ? answer.items : [];
      expect(rows.map(row => [row.entryId, row.locale])).toEqual([[id, "fr"]]);
      // 🔴 The French title, read in French as Cleo: the default language's
      // title would name the row in a language its link does not open.
      expect(rows[0]).toMatchObject({ entryTitle: "Titre FR" });
      expect(JSON.stringify(answer)).not.toContain("Title EN");
    });
  }
);

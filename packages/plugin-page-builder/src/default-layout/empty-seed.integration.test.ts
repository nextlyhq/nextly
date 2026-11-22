/**
 * Pages that name the empty seeded set, against a real instance on every
 * configured dialect: the one-time move and the write normalisation.
 *
 * What separates a correct release from a plausible broken one:
 * - the move rewrites the live copy of a published page AND the newer draft
 *   of another, without publishing either: the published page stays
 *   published, the draft stays a draft beside a live copy that keeps its own
 *   set, and the history names no person;
 * - a page on another set keeps it, and a run that has finished moves
 *   nothing more, a start of the site included;
 * - every write path an author or a script takes (the Direct API, REST, the
 *   Pages panel's duplicate, a batch inside a transaction) stores "Site
 *   default" for the empty seed, and leaves any other set as sent.
 *
 * Trapped pages are made the way older releases made them: with the seed not
 * yet recorded as the seed, so no normalisation applies to the write, then
 * the record put back.
 *
 * @module default-layout/empty-seed.integration.test
 */
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adapterOn,
  siteDatabase,
  type SiteDatabase,
} from "../__tests__/site-database-harness";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageDuplicatePath } from "../pages-write-contract";
import { pageBuilder } from "../plugin";
import { siteOptions } from "../schema/tables";

import {
  EMPTY_SEED_MOVED_OPTION,
  emptySeedMark,
  moveEmptySeedPages,
  MOVE_REASON,
  type EmptySeedParts,
} from "./empty-seed";
import { ensureDefaultLayout } from "./ensure-default";
import { layoutRemovalStore } from "../layout-removal/store";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./settings-single";
import { readLayoutSettings, relationId, writeLayoutSettings } from "./store";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

/** What a probe plugin reaches: the page builder's tables and a rewrite. */
interface Probe {
  db?: PluginDatabase;
  dialect?: Parameters<typeof layoutRemovalStore>[1];
  rewrite?: EmptySeedParts["rewrite"];
}

/** The probe's plugin name, which its rewrites' history records. */
const PROBE = "@test/empty-seed-probe";

function probePlugin(probe: Probe): PluginDefinition {
  return definePlugin({
    name: PROBE,
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      probe.db = ctx.db;
      probe.dialect = ctx.dialect;
      probe.rewrite = request =>
        ctx.services.collections.rewriteField(request, { as: "system" });
    },
  });
}

interface BatchAnswer {
  successful: number;
  failed: number;
  errors: { error: string }[];
}

/** Core's entry service, whose batch writer runs hooks in its own transaction. */
function entries(t: TestNextly) {
  return (
    t.getService("collectionsHandler") as unknown as {
      getEntryService(): {
        updateEntries(
          params: { collectionName: string; overrideAccess?: boolean },
          entries: { id: string; data: Record<string, unknown> }[]
        ): Promise<BatchAnswer>;
      };
    }
  ).getEntryService();
}

/**
 * The page builder on a site whose boot seeds an EMPTY set, as releases
 * before the starter header and footer did: a site drawing its header and
 * footer in code gets exactly that seed, so the pages trapped on it here are
 * the pages an upgraded site holds.
 */
const olderSite = () => pageBuilder({ siteHeaderFooter: "code" });

describe.each(getConfiguredTestDialects())(
  "pages on the empty seeded set (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: SiteDatabase | undefined;
    const probe: Probe = {};
    let warnings: string[] = [];

    const logger: NonNullable<CreateTestNextlyOptions["logger"]> = {
      debug() {},
      info() {},
      warn(message) {
        warnings.push(String(message));
      },
      error() {},
    };

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      warnings = [];
      vi.unstubAllEnvs();
    });

    function parts(): EmptySeedParts {
      if (probe.db === undefined || probe.dialect === undefined) {
        throw new Error("the probe did not boot");
      }
      const rewrite = probe.rewrite;
      if (rewrite === undefined) throw new Error("the probe has no rewrite");
      return { mark: emptySeedMark(probe.db, probe.dialect), rewrite };
    }

    function move(
      t: TestNextly,
      rewrite: EmptySeedParts["rewrite"] = parts().rewrite
    ) {
      return moveEmptySeedPages({
        nextly: t.nextly,
        slugs: SLUGS,
        pagesSlug: PAGES_SLUG,
        emptySeed: { ...parts(), rewrite },
        warn: message => warnings.push(message),
      });
    }

    /** The boot's own seed and move, settled. */
    async function settle(t: TestNextly): Promise<void> {
      if (probe.db === undefined || probe.dialect === undefined) {
        throw new Error("the probe did not boot");
      }
      // Joins the boot's own run, which `onReady` starts without awaiting.
      await ensureDefaultLayout({
        nextly: t.nextly,
        slugs: SLUGS,
        pagesSlug: PAGES_SLUG,
        removals: layoutRemovalStore(probe.db, probe.dialect),
        warn: () => {},
      });
      await vi.waitFor(
        async () => expect(await parts().mark.read()).not.toBeNull(),
        { timeout: 20_000, interval: 100 }
      );
    }

    /** A fresh site, with the move not yet made: as before the upgrade. */
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        logger,
        plugins: [olderSite(), probePlugin(probe)],
      });
      await settle(current);
      await forgetTheMove();
      return current;
    }

    /** The site started on `on`, its start-up work settled. */
    async function startOn(on: SiteDatabase): Promise<TestNextly> {
      await current?.destroy();
      current = await createTestNextly({
        adapter: await adapterOn(on),
        logger,
        plugins: [olderSite(), probePlugin(probe)],
      });
      await settle(current);
      return current;
    }

    async function forgetTheMove(): Promise<void> {
      const db = probe.db;
      if (db === undefined) throw new Error("the probe did not boot");
      await db
        .delete(siteOptions)
        .where(eq(db.table(siteOptions).name, EMPTY_SEED_MOVED_OPTION));
    }

    async function seedOf(t: TestNextly): Promise<string> {
      const { seededLayout } = await readLayoutSettings(t.nextly, SLUGS);
      if (seededLayout === null) throw new Error("no seed");
      return seededLayout;
    }

    /**
     * Run `writes` while the settings record no seed, as on a release before
     * this one: nothing then tells a write that the set is the seed.
     */
    async function asAnOlderRelease(
      t: TestNextly,
      writes: () => Promise<void>
    ): Promise<void> {
      const seed = await seedOf(t);
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { seededLayout: null }
      );
      try {
        await writes();
      } finally {
        await writeLayoutSettings(
          t.nextly,
          SLUGS,
          await readLayoutSettings(t.nextly, SLUGS),
          { seededLayout: seed }
        );
      }
    }

    async function set(t: TestNextly, title: string): Promise<string> {
      const created = await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: {
          title,
          slug: title.toLowerCase(),
          areas: [],
          status: "published",
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function page(
      t: TestNextly,
      title: string,
      data: Record<string, unknown>
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: PAGES_SLUG,
        data: { title, slug: title.toLowerCase(), ...data },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    /** A save of a published page, held as its working draft. */
    async function saveDraft(
      t: TestNextly,
      id: string,
      data: Record<string, unknown>
    ): Promise<void> {
      const live = await row(t, id);
      await t.nextly.update({
        collection: PAGES_SLUG,
        id,
        data: { ...data, _rev: live?._rev },
        overrideAccess: true,
      });
    }

    /** The page's main row: its live copy when published. */
    async function row(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown> | undefined> {
      const found = await t.nextly.find({
        collection: PAGES_SLUG,
        where: { id: { equals: id } },
        status: "all",
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      return found.items[0] as Record<string, unknown> | undefined;
    }

    /** The page as its editor opens it: its working draft when it has one. */
    async function latest(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown>> {
      const read = await t.nextly.findByID({
        collection: PAGES_SLUG,
        id,
        draft: true,
        depth: 0,
        overrideAccess: true,
      });
      return (read ?? {}) as Record<string, unknown>;
    }

    async function rewritesOf(
      t: TestNextly,
      id: string
    ): Promise<Record<string, unknown>[]> {
      const { items } = await t.nextly.contentEvents.list({
        subject: { kind: "collection", slug: PAGES_SLUG, id },
      } as never);
      return (items as unknown as Record<string, unknown>[]).filter(
        event => event.kind === "field-rewritten"
      );
    }

    /** A published page, a published page with a newer draft, a draft, and a page on another set. */
    async function trappedSite(t: TestNextly) {
      const seed = await seedOf(t);
      const other = await set(t, "Other");
      const ids = {
        published: "",
        newerDraft: "",
        unpublished: "",
        onOther: "",
        switchedOff: "",
      };
      await asAnOlderRelease(t, async () => {
        ids.published = await page(t, "Published", {
          layout: seed,
          status: "published",
        });
        ids.newerDraft = await page(t, "Drafted", {
          layout: other,
          status: "published",
        });
        await saveDraft(t, ids.newerDraft, {
          title: "Drafted again",
          layout: seed,
        });
        ids.unpublished = await page(t, "Unpublished", {
          layout: seed,
          status: "draft",
        });
        ids.onOther = await page(t, "Elsewhere", {
          layout: other,
          status: "published",
        });
        ids.switchedOff = await page(t, "Bare", {
          layout: seed,
          noHeaderFooter: true,
          status: "published",
        });
      });
      // CONTROL: the trap is in the data before the move.
      expect(relationId((await row(t, ids.published))?.layout)).toBe(seed);
      expect(await latest(t, ids.newerDraft)).toMatchObject({
        _isWorkingDraft: true,
        title: "Drafted again",
      });
      expect(relationId((await latest(t, ids.newerDraft)).layout)).toBe(seed);
      expect(relationId((await row(t, ids.unpublished))?.layout)).toBe(seed);
      return { seed, other, ids };
    }

    describe("the one-time move", () => {
      it("moves the live copy and the newer draft off the empty seed, publishing nothing", async () => {
        const t = await boot();
        const { other, ids } = await trappedSite(t);

        const outcome = await move(t);

        expect(outcome).toEqual({ kind: "pass", moved: 4, finished: true });
        // Published, live copy moved, still published.
        expect(await row(t, ids.published)).toMatchObject({
          status: "published",
        });
        expect(relationId((await row(t, ids.published))?.layout)).toBeNull();
        // The newer draft moved and is still a draft; the live copy keeps its set.
        expect(relationId((await row(t, ids.newerDraft))?.layout)).toBe(other);
        expect((await row(t, ids.newerDraft))?.title).toBe("Drafted");
        const draft = await latest(t, ids.newerDraft);
        expect(draft).toMatchObject({
          _isWorkingDraft: true,
          title: "Drafted again",
        });
        expect(relationId(draft.layout)).toBeNull();
        // Never published, still not.
        expect(await row(t, ids.unpublished)).toMatchObject({
          status: "draft",
        });
        expect(relationId((await row(t, ids.unpublished))?.layout)).toBeNull();
        // Another set's page keeps it.
        expect(relationId((await row(t, ids.onOther))?.layout)).toBe(other);
        expect(await rewritesOf(t, ids.onOther)).toEqual([]);
        // A page switched off stays switched off.
        expect(await row(t, ids.switchedOff)).toMatchObject({
          noHeaderFooter: true,
        });
        expect(relationId((await row(t, ids.switchedOff))?.layout)).toBeNull();
        // The history names no person: the plugin that moved it, and why.
        expect(await rewritesOf(t, ids.published)).toEqual([
          expect.objectContaining({
            actorKind: "plugin",
            actorId: PROBE,
            note: MOVE_REASON,
            payload: expect.objectContaining({
              field: "layout",
              copies: ["live"],
            }),
          }),
        ]);
        expect(await rewritesOf(t, ids.newerDraft)).toEqual([
          expect.objectContaining({
            actorKind: "plugin",
            actorId: PROBE,
            payload: expect.objectContaining({ copies: ["draft"] }),
          }),
        ]);
        expect(warnings).toContain(
          "[page-builder] moved 4 pages to the site default, because they named the empty seeded header & footer set"
        );
      });

      it("moves nothing on a second run, even a page put on the seed since", async () => {
        const t = await boot();
        await trappedSite(t);
        await move(t);
        const seed = await seedOf(t);
        let late = "";
        await asAnOlderRelease(t, async () => {
          late = await page(t, "Late", { layout: seed, status: "published" });
        });

        expect(await move(t)).toEqual({ kind: "done-before" });
        expect(relationId((await row(t, late))?.layout)).toBe(seed);
        expect(await rewritesOf(t, late)).toEqual([]);
      });

      it("leaves a page saved while it moved for the next pass, which moves it", async () => {
        const t = await boot();
        const seed = await seedOf(t);
        let busy = "";
        await asAnOlderRelease(t, async () => {
          busy = await page(t, "Busy", { layout: seed, status: "draft" });
        });
        const real = parts().rewrite;
        // An author saves the page between the move's read and its rewrite.
        const racing: EmptySeedParts["rewrite"] = async request => {
          if (request.id === busy) {
            await saveDraft(t, busy, { title: "Busy, edited" });
          }
          return real(request);
        };

        expect(await move(t, racing)).toEqual({
          kind: "pass",
          moved: 0,
          finished: false,
        });
        // Refused whole: the author's save stands and the page still names it.
        expect(await row(t, busy)).toMatchObject({ title: "Busy, edited" });
        expect(relationId((await row(t, busy))?.layout)).toBe(seed);
        expect(await parts().mark.read()).toBeNull();

        expect(await move(t)).toEqual({
          kind: "pass",
          moved: 1,
          finished: true,
        });
        expect(relationId((await row(t, busy))?.layout)).toBeNull();
        expect(await row(t, busy)).toMatchObject({ title: "Busy, edited" });
      });

      it("stops when the seed is given a header while the pass runs, leaving the pages it had not reached", async () => {
        const t = await boot();
        const seed = await seedOf(t);
        const ids: string[] = [];
        await asAnOlderRelease(t, async () => {
          ids.push(await page(t, "First", { layout: seed, status: "draft" }));
          ids.push(await page(t, "Second", { layout: seed, status: "draft" }));
        });
        const header = await t.nextly.create({
          collection: "components",
          data: {
            title: "Late header",
            slug: "late-header",
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [
                {
                  id: "h",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Site", level: 2 },
                },
              ],
            },
            status: "published",
          },
          overrideAccess: true,
        });
        const real = parts().rewrite;
        let filled = false;
        // An author publishes a header into the seed once the first page's
        // rewrite is under way: from then on its pages chose a real set.
        const racing: EmptySeedParts["rewrite"] = async request => {
          const done = await real(request);
          if (!filled) {
            filled = true;
            const seedRow = await t.nextly.findByID({
              collection: LAYOUTS_SLUG,
              id: seed,
              depth: 0,
              overrideAccess: true,
            });
            await t.nextly.update({
              collection: LAYOUTS_SLUG,
              id: seed,
              data: {
                areas: [{ area: "header", component: String(header.item.id) }],
                status: "published",
                _rev: (seedRow as { _rev?: unknown } | null)?._rev,
              },
              overrideAccess: true,
            });
          }
          return done;
        };

        const outcome = await move(t, racing);

        expect(outcome).toEqual({ kind: "pass", moved: 1, finished: false });
        const layouts = await Promise.all(
          ids.map(async id => relationId((await row(t, id))?.layout))
        );
        // One page moved before the header landed; the other keeps the seed.
        expect(layouts.filter(id => id === null)).toHaveLength(1);
        expect(layouts.filter(id => id === seed)).toHaveLength(1);
        // The next pass finds a seed with a header: the move is done.
        expect(await move(t)).toEqual({
          kind: "pass",
          moved: 0,
          finished: true,
        });
      });

      it("leaves the pages of a seed someone is filling, and records the move as done", async () => {
        const t = await boot();
        const seed = await seedOf(t);
        let kept = "";
        await asAnOlderRelease(t, async () => {
          kept = await page(t, "Kept", { layout: seed, status: "published" });
        });
        // A header in the seed's working draft: the seed is being filled.
        const component = await t.nextly.create({
          collection: "components",
          data: {
            title: "A header",
            slug: "a-header",
            content: {
              formatVersion: 1,
              kind: "component",
              nodes: [
                {
                  id: "h",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Site", level: 2 },
                },
              ],
            },
            status: "published",
          },
          overrideAccess: true,
        });
        const seedRow = await t.nextly.findByID({
          collection: LAYOUTS_SLUG,
          id: seed,
          depth: 0,
          overrideAccess: true,
        });
        await t.nextly.update({
          collection: LAYOUTS_SLUG,
          id: seed,
          data: {
            areas: [{ area: "header", component: String(component.item.id) }],
            _rev: (seedRow as { _rev?: unknown } | null)?._rev,
          },
          overrideAccess: true,
        });

        // Its pages stay, and the move waits: the draft may be discarded.
        expect(await move(t)).toEqual({
          kind: "pass",
          moved: 0,
          finished: false,
        });
        expect(relationId((await row(t, kept))?.layout)).toBe(seed);
        expect(await parts().mark.read()).toBeNull();
        // And a write naming it keeps it: it is not the empty seed now.
        const written = await page(t, "Written", {
          layout: seed,
          status: "draft",
        });
        expect(relationId((await row(t, written))?.layout)).toBe(seed);

        // Published, the seed is a set like any other: the move is done.
        const draft = await t.nextly.findByID({
          collection: LAYOUTS_SLUG,
          id: seed,
          draft: true,
          depth: 0,
          overrideAccess: true,
        });
        await t.nextly.update({
          collection: LAYOUTS_SLUG,
          id: seed,
          data: {
            status: "published",
            _rev: (draft as { _rev?: unknown } | null)?._rev,
          },
          overrideAccess: true,
        });
        expect(await move(t)).toEqual({
          kind: "pass",
          moved: 0,
          finished: true,
        });
        expect(relationId((await row(t, kept))?.layout)).toBe(seed);
        expect(relationId((await row(t, written))?.layout)).toBe(seed);
      });

      // Not on SQLite: a start of this harness there builds the plugin's
      // tables afresh, so nothing a start left is there for the next one.
      it.skipIf(dialect === "sqlite")(
        "moves them at the site's start, once: a second start moves nothing",
        async () => {
          database = await siteDatabase(dialect, "pb_empty_seed");
          let t = await startOn(database);
          const { ids } = await trappedSite(t);
          await forgetTheMove();

          // The upgrade's start.
          t = await startOn(database);
          expect(relationId((await row(t, ids.published))?.layout)).toBeNull();
          expect(
            relationId((await latest(t, ids.newerDraft)).layout)
          ).toBeNull();
          // Made by the page builder's own start, so its history names it.
          expect(await rewritesOf(t, ids.published)).toEqual([
            expect.objectContaining({
              actorKind: "plugin",
              actorId: PAGE_BUILDER_PLUGIN_NAME,
              note: MOVE_REASON,
            }),
          ]);
          expect(warnings).toContain(
            "[page-builder] moved 4 pages to the site default, because they named the empty seeded header & footer set"
          );
          const seed = await seedOf(t);
          let late = "";
          await asAnOlderRelease(t, async () => {
            late = await page(t, "Late", { layout: seed, status: "published" });
          });

          // The next start.
          t = await startOn(database);
          expect(relationId((await row(t, late))?.layout)).toBe(seed);
          expect(await rewritesOf(t, late)).toEqual([]);
        }
      );
    });

    describe("a write naming the empty seed", () => {
      it("stores Site default through the Direct API, keeping the switch as sent", async () => {
        const t = await boot();
        const seed = await seedOf(t);
        const other = await set(t, "Other");

        const created = await page(t, "Direct", {
          layout: seed,
          status: "draft",
        });
        const switchedOff = await page(t, "Off", {
          layout: seed,
          noHeaderFooter: true,
          status: "draft",
        });
        const elsewhere = await page(t, "Elsewhere", {
          layout: other,
          status: "draft",
        });

        expect(relationId((await row(t, created))?.layout)).toBeNull();
        expect(await row(t, switchedOff)).toMatchObject({
          noHeaderFooter: true,
        });
        expect(relationId((await row(t, switchedOff))?.layout)).toBeNull();
        // CONTROL: another set, empty too, is kept: only the seed is a trap.
        expect(relationId((await row(t, elsewhere))?.layout)).toBe(other);

        await saveDraft(t, elsewhere, { layout: seed });
        expect(relationId((await latest(t, elsewhere)).layout)).toBeNull();
      });

      it("stores Site default for a REST save and for the Pages panel's duplicate", async () => {
        process.env.NEXTLY_SECRET =
          process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!";
        const t = await boot();
        const seed = await seedOf(t);
        const key = await editorKey(t);
        const target = await page(t, "Target", { status: "draft" });
        let source = "";
        await asAnOlderRelease(t, async () => {
          source = await page(t, "Source", { layout: seed, status: "draft" });
        });

        const patched = await rest(
          "PATCH",
          ["collections", PAGES_SLUG, "entries", target],
          key,
          { layout: seed, _rev: (await row(t, target))?._rev }
        );
        expect(patched.status, patched.text).toBe(200);
        expect(relationId((await row(t, target))?.layout)).toBeNull();

        const duplicated = await rest(
          "POST",
          [
            "plugins",
            ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
            ...pageDuplicatePath({ collection: PAGES_SLUG, id: source })
              .slice(1)
              .split("/"),
          ],
          key
        );
        expect(duplicated.status, duplicated.text).toBe(200);
        const copy = String(
          (JSON.parse(duplicated.text) as { item: { id: unknown } }).item.id
        );
        expect(copy).not.toBe(source);
        expect(relationId((await row(t, copy))?.layout)).toBeNull();
        // CONTROL: the source still names it, so the copy was cleared on its write.
        expect(relationId((await row(t, source))?.layout)).toBe(seed);
      });

      it("moves a page a batch put on it, once the batch commits", async () => {
        const t = await boot();
        const seed = await seedOf(t);
        const target = await page(t, "Batched", { status: "draft" });
        const live = await row(t, target);

        const answer = await entries(t).updateEntries(
          { collectionName: PAGES_SLUG, overrideAccess: true },
          [{ id: target, data: { layout: seed, _rev: live?._rev } }]
        );

        expect(answer.successful, JSON.stringify(answer)).toBe(1);
        // Moved after the batch's commit, not stored as sent then cleared.
        expect(warnings).toContain(
          "[page-builder] a page written in a batch named the empty seeded header & footer set, so it now uses the site default"
        );
        await vi.waitFor(
          async () =>
            expect(relationId((await row(t, target))?.layout)).toBeNull(),
          { timeout: 10_000, interval: 100 }
        );
      });
    });

    /** A key that may read, create and update pages, minted by the first user. */
    async function editorKey(t: TestNextly): Promise<string> {
      const direct = t.nextly as unknown as {
        users: {
          create(args: {
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
        permissions: {
          find(args: {
            limit: number;
          }): Promise<{ items: { id: string; slug: string }[] }>;
        };
        roles: {
          create(args: {
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
      };
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 500 });
      const ids = [
        `create-${PAGES_SLUG}`,
        `read-${PAGES_SLUG}`,
        `update-${PAGES_SLUG}`,
        `read-${LAYOUTS_SLUG}`,
      ].map(slug => {
        const found = seeded.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await direct.roles.create({
        data: {
          name: "Empty seed editor",
          slug: "empty-seed-editor",
          permissionIds: ids,
        },
      });
      const keys = t.getService("apiKeyService") as unknown as {
        createApiKey(
          userId: string,
          input: {
            name: string;
            tokenType: string;
            roleId?: string;
            expiresIn: string;
          }
        ): Promise<{ key: string }>;
      };
      const { key } = await keys.createApiKey(owner.item.id, {
        name: "empty seed editor",
        tokenType: "role-based",
        roleId: role.item.id,
        expiresIn: "unlimited",
      });
      return key;
    }

    /** One request through core's handler, with an API key. */
    async function rest(
      method: "PATCH" | "POST",
      segments: string[],
      key: string,
      body?: unknown
    ): Promise<{ status: number; text: string }> {
      const handlers = createDynamicHandlers();
      const response = await handlers[method](
        new Request(
          `http://localhost/api/${segments.map(encodeURIComponent).join("/")}`,
          {
            method,
            headers: {
              authorization: `Bearer ${key}`,
              ...(body === undefined
                ? {}
                : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }
        ),
        { params: Promise.resolve({ params: segments }) }
      );
      return { status: response.status, text: await response.text() };
    }
  }
);

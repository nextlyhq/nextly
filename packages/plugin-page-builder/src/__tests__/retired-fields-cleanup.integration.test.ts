/**
 * A component's retired field values, taken out of every document still
 * holding them once the removal is published, against a real database per
 * dialect.
 *
 * What only a database shows: that the walk reaches every kind of host (a
 * collection entry, a Single, another component, a pattern) whether or not
 * the usage index lists it; that a working draft is stripped while the live
 * row under it waits for the draft to be published; that a draft save of the
 * component owes nothing; that a save racing the walk keeps no value
 * whichever commits last; and that a retirement recorded after a finished walk
 * is walked for.
 *
 * @module __tests__/retired-fields-cleanup.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";
import {
  RETIRED_CLEANUP_SERVICE,
  type CleanupPass,
  type RetiredCleanupService,
} from "../retired-cleanup";

/** Where the component usage index keeps its rows. */
const COMPONENT_ROWS = "page_builder__component_usage";

type Row = Record<string, unknown>;
type Kind = "page" | "component" | "pattern";

const NOTES = "notes";
const HOMEPAGE = "homepage";
const HARNESS = "@t/retired-cleanup-harness";

const heading = (id: string): Row => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

/** A hero exposing the named fields, each on a heading of its own. */
const hero = (fields: string[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [heading("h-title"), heading("h-body")],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: `h-${id}`,
    propPath: "text",
    type: "text",
  })),
});

/** A document of `kind` placing the hero once, with these values. */
const placing = (kind: Kind, componentId: string, overrides: Row): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes: [
    {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId, overrides },
    },
  ],
});

/** The values every host is written with before the removal. */
const BOTH = { title: "Old", body: "Kept" };

/** The overrides the first placement of a stored blocks value holds. */
function overridesOf(stored: unknown): unknown {
  const document = (
    typeof stored === "string" ? JSON.parse(stored) : stored
  ) as { nodes: { props: { overrides?: unknown } }[] };
  return document.nodes[0]!.props.overrides;
}

/** What the harness's hook does, switched by each test as it runs. */
interface Switches {
  /** Hold the next note write with this title once its strip has run. */
  hold?: { title: string; reached: () => void; release: Promise<void> };
  /**
   * Run once inside the walk's next note write, before that write takes its
   * row lock: the walk writes the blocks field alone, so its data carries no
   * title.
   */
  duringWalkWrite?: () => Promise<void>;
}

/**
 * A plugin whose hook holds a note write after the strip has run on it and
 * before it commits: validation, and so every `before*` hook, has run by
 * `beforeChange`.
 */
function harness(switches: Switches): PluginDefinition {
  return definePlugin({
    name: HARNESS,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      ctx.hooks.on("beforeChange", NOTES, async context => {
        const data = (context as { data?: Record<string, unknown> }).data;
        const during = switches.duringWalkWrite;
        if (during !== undefined && data !== undefined && !("title" in data)) {
          switches.duringWalkWrite = undefined;
          await during();
          return;
        }
        const hold = switches.hold;
        const title = (context as { data?: { title?: unknown } }).data?.title;
        if (hold === undefined || title !== hold.title) return;
        switches.hold = undefined;
        hold.reached();
        await hold.release;
      });
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "a component's retired field values, cleaned from every host (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(switches: Switches = {}) {
      const plugin = pageBuilder();
      const cleanup = () =>
        plugin.contributes?.services?.[
          RETIRED_CLEANUP_SERVICE
        ]?.() as RetiredCleanupService;
      current = await createTestNextly({
        dialect,
        plugins: [plugin, harness(switches)],
        collections: [
          {
            slug: NOTES,
            status: true,
            fields: [
              { name: "title", type: "text" },
              { name: "content", type: BLOCKS_TYPE },
            ],
          } as never,
        ],
        singles: [
          {
            slug: HOMEPAGE,
            fields: [{ name: "content", type: BLOCKS_TYPE }],
          } as never,
        ],
      });
      return { t: current, cleanup };
    }

    /** Pass after pass until one finishes, as the sweep runs it. */
    async function cleanToTheEnd(
      cleanup: () => RetiredCleanupService
    ): Promise<CleanupPass[]> {
      const passes: CleanupPass[] = [];
      for (let pass = 0; pass < 20; pass += 1) {
        const done = await cleanup().advance({ maxDocuments: 3 });
        passes.push(done);
        if (done.finished) return passes;
      }
      throw new Error("the cleanup never finished");
    }

    async function publishedHero(t: TestNextly): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Hero",
          slug: "hero",
          content: hero(["title", "body"]),
          status: "published",
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function note(
      t: TestNextly,
      componentId: string,
      title = "Note"
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: NOTES,
        data: {
          title,
          content: placing("page", componentId, BOTH),
          status: "published",
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function stored(
      t: TestNextly,
      collection: string,
      id: string,
      draft = false
    ): Promise<unknown> {
      const row = (await t.nextly.findByID({
        collection,
        id,
        depth: 0,
        overrideAccess: true,
        status: "all",
        ...(draft ? { draft: true } : {}),
      })) as Row;
      return overridesOf(row.content);
    }

    /** Publish the hero without the named fields. */
    async function publishWithout(
      t: TestNextly,
      id: string,
      kept: string[]
    ): Promise<void> {
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { content: hero(kept), status: "published", _overwrite: true },
        overrideAccess: true,
      });
    }

    it("takes the value out of every host, the ones the usage index does not list too", async () => {
      const { t, cleanup } = await boot();
      const heroId = await publishedHero(t);
      const listed = await note(t, heroId, "Listed");
      const unlisted = await note(t, heroId, "Unlisted");
      const card = String(
        (
          await t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: "Card",
              slug: "card",
              content: placing("component", heroId, BOTH),
            },
            overrideAccess: true,
          })
        ).item.id
      );
      const pattern = String(
        (
          await t.nextly.create({
            collection: PATTERNS_SLUG,
            data: {
              title: "Banner",
              slug: "banner",
              granularity: "section",
              content: placing("pattern", heroId, BOTH),
            },
            overrideAccess: true,
          })
        ).item.id
      );
      await t.nextly.updateSingle({
        slug: HOMEPAGE,
        data: { content: placing("page", heroId, BOTH), _overwrite: true },
        overrideAccess: true,
      });
      // The index forgets one note, as if it never saw it.
      const rows = await t.adapter.select<Row>(COMPONENT_ROWS, {});
      const forgotten = rows.filter(row =>
        String(row.entityKey).includes(unlisted)
      );
      expect(forgotten.length).toBeGreaterThan(0);
      for (const row of forgotten) {
        await t.adapter.delete(COMPONENT_ROWS, {
          and: [{ column: "id", op: "=", value: String(row.id) }],
        });
      }

      await publishWithout(t, heroId, ["body"]);
      const passes = await cleanToTheEnd(cleanup);

      const kept = { body: "Kept" };
      expect(await stored(t, NOTES, listed)).toEqual(kept);
      expect(await stored(t, NOTES, unlisted)).toEqual(kept);
      expect(await stored(t, COMPONENTS_SLUG, card)).toEqual(kept);
      expect(await stored(t, PATTERNS_SLUG, pattern)).toEqual(kept);
      const single = (await t.nextly.findSingle({
        slug: HOMEPAGE,
        overrideAccess: true,
      })) as Row;
      expect(overridesOf(single.content)).toEqual(kept);
      // Walked once, and owed nothing more after.
      expect(passes.flatMap(pass => pass.walked).length).toBeGreaterThan(0);
      expect((await cleanup().advance()).walked).toEqual([]);
    });

    it("strips a working draft, and leaves the live row under it until the draft is published", async () => {
      const { t, cleanup } = await boot();
      const heroId = await publishedHero(t);
      // The plugin's pages keep working drafts.
      const created = await t.nextly.create({
        collection: PAGES_SLUG,
        data: {
          title: "Live",
          slug: "live",
          status: "published",
          content: placing("page", heroId, BOTH),
        },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      // An edit saved without publishing: a pending draft over the live row.
      await t.nextly.update({
        collection: PAGES_SLUG,
        id,
        data: {
          content: placing("page", heroId, { title: "Draft", body: "Kept" }),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(await stored(t, PAGES_SLUG, id, true)).toEqual({
        title: "Draft",
        body: "Kept",
      });

      await publishWithout(t, heroId, ["body"]);
      const passes = await cleanToTheEnd(cleanup);

      expect(await stored(t, PAGES_SLUG, id, true)).toEqual({ body: "Kept" });
      // The live row cannot be written without putting the draft live.
      expect(await stored(t, PAGES_SLUG, id)).toEqual(BOTH);
      expect(
        passes
          .flatMap(pass => pass.walked)
          .flatMap(walk => walk.report.left)
          .map(left => left.reason)
      ).toContain("pending-draft");

      await t.nextly.update({
        collection: PAGES_SLUG,
        id,
        data: { status: "published", _overwrite: true },
        overrideAccess: true,
      });
      expect(await stored(t, PAGES_SLUG, id)).toEqual({ body: "Kept" });
    });

    it("owes nothing for a removal only saved as the component's draft", async () => {
      const { t, cleanup } = await boot();
      const heroId = await publishedHero(t);
      const id = await note(t, heroId);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: heroId,
        data: { content: hero(["body"]), _overwrite: true },
        overrideAccess: true,
      });

      const pass = await cleanup().advance();

      expect(pass).toEqual({ walked: [], finished: true });
      expect(await stored(t, NOTES, id)).toEqual(BOTH);
    });

    it("keeps no value from a save that commits after the walk has passed it", async () => {
      const switches: Switches = {};
      const { t, cleanup } = await boot(switches);
      const heroId = await publishedHero(t);
      const id = await note(t, heroId);
      let reached!: () => void;
      let release!: () => void;
      const held = new Promise<void>(resolve => (reached = resolve));
      switches.hold = {
        title: "Edited",
        reached: () => reached(),
        release: new Promise<void>(resolve => (release = resolve)),
      };
      // Stripped before the removal is recorded, so it keeps the value.
      const save = t.nextly.update({
        collection: NOTES,
        id,
        data: {
          title: "Edited",
          content: placing("page", heroId, BOTH),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await held;
      await publishWithout(t, heroId, ["body"]);
      await cleanToTheEnd(cleanup);
      release();
      await save;
      // The save put the value back, and its commit sent the walk back.
      expect(await stored(t, NOTES, id)).toEqual(BOTH);

      await cleanToTheEnd(cleanup);

      expect(await stored(t, NOTES, id)).toEqual({ body: "Kept" });
      const row = (await t.nextly.findByID({
        collection: NOTES,
        id,
        depth: 0,
        overrideAccess: true,
      })) as Row;
      expect(row.title).toBe("Edited");
    });

    it("keeps an author's edit that commits between the walk's read and its write, and still takes the value out", async () => {
      const switches: Switches = {};
      const { t, cleanup } = await boot(switches);
      const heroId = await publishedHero(t);
      const id = await note(t, heroId);
      await publishWithout(t, heroId, ["body"]);
      // The walk, as the system, has read the note and computed its write;
      // the author's save, still holding the retired value, commits first.
      switches.duringWalkWrite = async () => {
        await t.nextly.update({
          collection: NOTES,
          id,
          data: {
            title: "Author edit",
            content: placing("page", heroId, { title: "Old", body: "Author" }),
          },
          overrideAccess: true,
        });
      };

      await cleanToTheEnd(cleanup);

      expect(switches.duringWalkWrite).toBeUndefined();
      // The walk's write, made from what it read before the save, was refused
      // and the note read again: the author's body is kept, the retired value
      // is not.
      expect(await stored(t, NOTES, id)).toEqual({ body: "Author" });
      const row = (await t.nextly.findByID({
        collection: NOTES,
        id,
        depth: 0,
        overrideAccess: true,
      })) as Row;
      expect(row.title).toBe("Author edit");
    });

    it("keeps no value from a save that commits before the walk reads it", async () => {
      const switches: Switches = {};
      const { t, cleanup } = await boot(switches);
      const heroId = await publishedHero(t);
      const id = await note(t, heroId);
      let reached!: () => void;
      let release!: () => void;
      const held = new Promise<void>(resolve => (reached = resolve));
      switches.hold = {
        title: "Edited",
        reached: () => reached(),
        release: new Promise<void>(resolve => (release = resolve)),
      };
      const save = t.nextly.update({
        collection: NOTES,
        id,
        data: {
          title: "Edited",
          content: placing("page", heroId, BOTH),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await held;
      await publishWithout(t, heroId, ["body"]);
      release();
      await save;

      await cleanToTheEnd(cleanup);

      expect(await stored(t, NOTES, id)).toEqual({ body: "Kept" });
    });

    it("starts over for a field retired while a walk is under way", async () => {
      const { t, cleanup } = await boot();
      const heroId = await publishedHero(t);
      const ids = [
        await note(t, heroId, "One"),
        await note(t, heroId, "Two"),
        await note(t, heroId, "Three"),
      ];
      await publishWithout(t, heroId, ["body"]);
      // A document at a time, until the final walk has read the first note:
      // the converting walk rewrites it, so only the final walk finds it
      // unchanged.
      let read = false;
      for (let pass = 0; pass < 50 && !read; pass += 1) {
        const done = await cleanup().advance({ maxDocuments: 1 });
        expect(done.finished).toBe(false);
        read = done.walked.some(walk =>
          walk.report.unchanged.some(host => host.id === ids[0])
        );
      }
      expect(read).toBe(true);

      await publishWithout(t, heroId, []);
      await cleanToTheEnd(cleanup);

      for (const id of ids) {
        expect(await stored(t, NOTES, id)).toBeUndefined();
      }
    });

    it("walks again for a field retired after a finished walk", async () => {
      const { t, cleanup } = await boot();
      const heroId = await publishedHero(t);
      const id = await note(t, heroId);
      await publishWithout(t, heroId, ["body"]);
      await cleanToTheEnd(cleanup);
      expect(await stored(t, NOTES, id)).toEqual({ body: "Kept" });

      await publishWithout(t, heroId, []);
      const passes = await cleanToTheEnd(cleanup);

      expect(passes.flatMap(pass => pass.walked).length).toBeGreaterThan(0);
      // A placement left with no value of its own keeps none at all.
      expect(await stored(t, NOTES, id)).toBeUndefined();
    });
  }
);

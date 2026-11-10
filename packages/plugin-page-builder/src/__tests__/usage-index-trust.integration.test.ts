/**
 * Whether "exact" usage counts are true: the four ways the usage index used
 * to report itself whole while it was not.
 *
 * - A maintenance write that failed left health reporting the index whole.
 *   Now the failure marks the index dirty, and only a full rebuild started
 *   after it clears the mark; a later successful save does not.
 * - A backfill pass that started under one derivation could land its rows
 *   after a newer run had walked the document. Now every write a pass makes
 *   checks that its run is still current, and a replaced pass writes nothing.
 * - A scope larger than one job's budget started again on every tick and
 *   never finished. Now the walk records the last document it finished and
 *   the next tick resumes after it.
 * - A super-admin could add a progress row that marked a scope as walked, and
 *   its documents were never indexed. Progress now lives in tables only the
 *   plugin reaches; a row added to the old progress collection changes
 *   nothing.
 *
 * Driven through what the plugin ships: its backfill job, its health service,
 * and its save hooks, against a real database per dialect, because the fence
 * and the bookkeeping are transactions and only a real connection pool shows
 * what they hold.
 *
 * @module __tests__/usage-index-trust.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { CLASS_USAGE_INDEX_SLUG } from "../collections/class-usage-index";
import { COMPONENT_USAGE_INDEX_SLUG } from "../collections/component-usage-index";
import { COMPONENTS_SLUG } from "../collections/components";
import { USAGE_BACKFILL_STATE_SLUG } from "../collections/usage-backfill-state";
import { componentUsageIndex } from "../component-usage";
import { pageBuilder } from "../plugin";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";
import { backfillGeneration, backfillScopeKey } from "../usage-backfill-scope";
import {
  USAGE_HEALTH_SERVICE,
  type UsageHealthService,
} from "../usage-health-service";
import { indexIsWhole, type UsageIndexHealth } from "../usage-index-health";

type Node = Record<string, unknown>;

const text = (id: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const placing = (id: string, componentId: string): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const document = (kind: "page" | "component", nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
});

/**
 * What the tests switch at run time inside the site's own hooks: a write to
 * the component index that fails, a page read that waits, a page read that
 * spends the job's budget.
 */
interface Switches {
  /** Reject every write to the component index while true. */
  failIndexWrites: boolean;
  /** Resolve this once, the next time a page is read by id, then wait for `release`. */
  pauseNextPageRead?: { reached: () => void; release: Promise<void> };
  /** Move this deadline into the past whenever a page is read. */
  spendOnPageRead?: Date;
}

/** A site plugin whose hooks do what `switches` says, read when they run. */
function sitePlugin(switches: Switches): PluginDefinition {
  return definePlugin({
    name: "@test/usage-trust-site",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      ctx.hooks.on("beforeCreate", COMPONENT_USAGE_INDEX_SLUG, () => {
        if (switches.failIndexWrites) {
          throw new Error("the component index rejected this write");
        }
      });
      ctx.hooks.on("afterRead", "pages", async context => {
        switches.spendOnPageRead?.setTime(0);
        const pause = switches.pauseNextPageRead;
        // A read by id, which carries one document rather than a list: the
        // backfill lists ids first and then reads each document by id, and it
        // is that read whose answer the pass writes from.
        if (pause === undefined || Array.isArray(context.data)) return;
        switches.pauseNextPageRead = undefined;
        pause.reached();
        await pause.release;
      });
    },
  });
}

/** The plugin's own backfill job and health service, as it contributes them. */
function installed(plugin: PluginDefinition) {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === USAGE_BACKFILL_JOB
  );
  const health = plugin.contributes?.services?.[USAGE_HEALTH_SERVICE]?.() as
    | UsageHealthService
    | undefined;
  if (job === undefined || health === undefined) {
    throw new Error("the page builder contributed no backfill job or health");
  }
  return {
    /** One tick of the sweep, with `deadline` as its budget. */
    tick: (deadline: Date = new Date(Date.now() + 60_000)) =>
      job.handler(
        null as never,
        {
          user: null,
          now: new Date(),
          deadline,
          content: {},
        } as never
      ),
    health: (): Promise<UsageIndexHealth> =>
      health.read(componentUsageIndex, COMPONENT_USAGE_INDEX_SLUG),
  };
}

describe.each(getConfiguredTestDialects())(
  "the usage index reports itself whole only when it is (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(
      switches: Switches,
      limits: DocumentLimits = { ...DEFAULT_LIMITS }
    ) {
      const options = { limits };
      const plugin = pageBuilder(options);
      current = await createTestNextly({
        dialect,
        plugins: [plugin, sitePlugin(switches)],
      });
      return { t: current, options, ...installed(plugin) };
    }

    async function component(t: TestNextly, slug: string): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: slug,
          slug,
          content: document("component", [text(`${slug}-t`)]),
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function page(t: TestNextly, componentId: string): Promise<string> {
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Page",
          slug: `page-${String(Math.random()).slice(2, 10)}`,
          content: document("page", [placing("i1", componentId)]),
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    /** The components each page's index rows name, read as the system. */
    async function referencesOf(
      t: TestNextly,
      pageIds: readonly string[]
    ): Promise<Record<string, string[]>> {
      const rows = await t.nextly.find({
        collection: COMPONENT_USAGE_INDEX_SLUG,
        where: { entity: { equals: "pages" }, kind: { equals: "reference" } },
        limit: 500,
        overrideAccess: true,
      });
      const found: Record<string, string[]> = {};
      for (const id of pageIds) found[id] = [];
      for (const item of rows.items as {
        entityKey: string;
        componentId: string;
      }[]) {
        if (!(item.entityKey in found)) continue;
        const named = found[item.entityKey]!;
        if (!named.includes(item.componentId)) named.push(item.componentId);
      }
      for (const id of pageIds) found[id]!.sort();
      return found;
    }

    /**
     * Remove every component index row of the pages, as a site that installed
     * the plugin over existing content has none for them.
     */
    async function forgetPages(t: TestNextly): Promise<void> {
      const rows = await t.nextly.find({
        collection: COMPONENT_USAGE_INDEX_SLUG,
        where: { entity: { equals: "pages" } },
        limit: 500,
        overrideAccess: true,
      });
      for (const item of rows.items as { id: string }[]) {
        await t.nextly.delete({
          collection: COMPONENT_USAGE_INDEX_SLUG,
          id: item.id,
          overrideAccess: true,
        });
      }
    }

    describe("a maintenance write that failed", () => {
      it("keeps health from whole until a FULL rebuild, not a later save", async () => {
        const switches: Switches = { failIndexWrites: false };
        const { t, tick, health } = await boot(switches);
        const header = await component(t, "header");
        const first = await page(t, header);
        await tick();
        // CONTROL: the index is whole before anything fails, so what follows
        // is the failure's effect and not a site that never reads as whole.
        expect(indexIsWhole(await health())).toBe(true);

        switches.failIndexWrites = true;
        const failed = await page(t, header);
        switches.failIndexWrites = false;

        const afterFailure = await health();
        expect({
          dirty: afterFailure.dirty,
          whole: indexIsWhole(afterFailure),
        }).toEqual({ dirty: true, whole: false });

        // A later save that succeeds repairs its own document and says nothing
        // about the one that failed.
        const later = await page(t, header);
        expect(indexIsWhole(await health())).toBe(false);
        expect(await referencesOf(t, [failed, later])).toEqual({
          [failed]: [],
          [later]: [header],
        });

        // The full rebuild walks the site again, repairs the failed page and
        // only then clears the mark.
        await tick();
        const rebuilt = await health();
        expect({ dirty: rebuilt.dirty, whole: indexIsWhole(rebuilt) }).toEqual({
          dirty: false,
          whole: true,
        });
        expect(await referencesOf(t, [first, failed, later])).toEqual({
          [first]: [header],
          [failed]: [header],
          [later]: [header],
        });
      });
    });

    describe("a backfill pass a newer run replaced", () => {
      it("writes nothing once the derivation has moved", async () => {
        const switches: Switches = { failIndexWrites: false };
        const { t, options, tick } = await boot(switches);
        const header = await component(t, "header");
        const footer = await component(t, "footer");
        const home = await page(t, header);
        await forgetPages(t);

        // The first pass reads the page as it is now, placing `header`, and
        // waits there before writing.
        let reached!: () => void;
        const atRead = new Promise<void>(resolve => {
          reached = resolve;
        });
        let release!: () => void;
        switches.pauseNextPageRead = {
          reached,
          release: new Promise<void>(resolve => {
            release = resolve;
          }),
        };
        const stale = tick();
        await atRead;

        // The bounds move, which starts a new run. It walks the site whole,
        // and then the page changes to place `footer`, which its save
        // records.
        options.limits = {
          ...DEFAULT_LIMITS,
          maxBytes: DEFAULT_LIMITS.maxBytes + 1,
        };
        await tick();
        await t.nextly.update({
          collection: "pages",
          id: home,
          data: {
            content: document("page", [placing("i1", footer)]),
            _overwrite: true,
          },
          overrideAccess: true,
        });
        expect(await referencesOf(t, [home])).toEqual({ [home]: [footer] });

        // The replaced pass resumes with the page as it read it. Unfenced, it
        // would put `header` back and remove `footer`, and the index would
        // name a component the page no longer places.
        release();
        await stale;
        expect(await referencesOf(t, [home])).toEqual({ [home]: [footer] });
      });
    });

    describe("a scope larger than one tick", () => {
      it("resumes inside the scope on each tick, and finishes", async () => {
        const switches: Switches = { failIndexWrites: false };
        const { t, tick, health } = await boot(switches);
        const header = await component(t, "header");
        const pages = [
          await page(t, header),
          await page(t, header),
          await page(t, header),
        ];
        await forgetPages(t);

        // Every tick's budget runs out on its first page read, so a tick
        // finishes one document of the scope and stops. Starting the scope
        // again on each tick, it would never get past the first.
        let ticks = 0;
        while (!indexIsWhole(await health()) && ticks < 20) {
          const deadline = new Date(Date.now() + 60_000);
          switches.spendOnPageRead = deadline;
          await tick(deadline);
          ticks += 1;
        }
        switches.spendOnPageRead = undefined;

        expect(indexIsWhole(await health())).toBe(true);
        // The budget really did stop the walk inside the scope.
        expect(ticks).toBeGreaterThan(pages.length);
        // And the pages an earlier tick finished kept their rows when a later
        // tick, which never saw them, swept the scope.
        expect(await referencesOf(t, pages)).toEqual(
          Object.fromEntries(pages.map(id => [id, [header]]))
        );
      });
    });

    describe("progress a super-admin forges", () => {
      it("is not trusted to skip a scope", async () => {
        const switches: Switches = { failIndexWrites: false };
        const limits = { ...DEFAULT_LIMITS };
        const { t, tick, health } = await boot(switches, limits);
        const header = await component(t, "header");
        const home = await page(t, header);
        await forgetPages(t);

        // Every scope the site has, claimed as walked under the current
        // derivation, through the old progress collection, as the system,
        // which is what a super-admin's edit amounts to.
        const generation = backfillGeneration({
          limits,
          classIndex: CLASS_USAGE_INDEX_SLUG,
          componentIndex: COMPONENT_USAGE_INDEX_SLUG,
        });
        for (const variant of ["published", "draft"] as const) {
          await t.nextly.create({
            collection: USAGE_BACKFILL_STATE_SLUG,
            data: {
              generation,
              scopeKey: backfillScopeKey({
                entity: "pages",
                field: "content",
                locale: "",
                variant,
              }),
            },
            overrideAccess: true,
          });
        }
        // And the plugin's own progress tables are no collection at all, so no
        // admin screen, REST route or Direct API call writes them.
        await expect(
          t.nextly.create({
            collection: "page_builder__usage_progress",
            data: { token: "forged", scopeKey: "forged", done: true },
            overrideAccess: true,
          })
        ).rejects.toThrow();

        expect(indexIsWhole(await health())).toBe(false);

        await tick();

        expect(await referencesOf(t, [home])).toEqual({ [home]: [header] });
        expect(indexIsWhole(await health())).toBe(true);
      });
    });
  }
);

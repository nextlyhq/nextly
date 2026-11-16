/**
 * The usage index counts every document that places a component, and keeps
 * its rows where only the plugin reaches them.
 *
 * - A Single that places a component is counted, found as a host, and judged
 *   when the component changes, as a collection entry is.
 * - A page that installs a component only through a placement's override, or
 *   a definition whose variant installs one, is counted as using it, so a
 *   change to that component judges the page.
 * - The rows live in the plugin's own tables. An existing site that upgrades
 *   reads as not whole until every scope has been walked into them, and
 *   progress that is incomplete, or rows left in the retired collection, never
 *   make a count read as exact.
 * - A full rebuild re-derives every row from the stored documents, so a row a
 *   race dropped comes back.
 *
 * Driven through what the plugin ships (its save hooks, backfill job, health
 * service and component save validation) against a real database per dialect.
 *
 * @module __tests__/usage-index-every-host.integration.test
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

import { classUsageIndex } from "../class-usage-reconcile";
import { COMPONENT_USAGE_INDEX_SLUG } from "../collections/component-usage-index";
import { COMPONENTS_SLUG } from "../collections/components";
import { componentUsageCount, componentUsageIndex } from "../component-usage";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";
import { backfillScopeKey } from "../usage-backfill-scope";
import {
  USAGE_HEALTH_SERVICE,
  type UsageHealthService,
} from "../usage-health-service";
import { usageBookkeeping } from "../usage-bookkeeping";
import { indexIsWhole } from "../usage-index-health";
import {
  usageTableOf,
  usageTableRows,
  type UsageDb,
} from "../usage-index-tables";

type Node = Record<string, unknown>;

/** Where the component index's rows live. */
const COMPONENT_ROWS = "page_builder__component_usage";
const CLASS_ROWS = "page_builder__class_usage";
/** Where the backfill's run and its progress live. */
const RUNS = "page_builder__usage_runs";
const PROGRESS = "page_builder__usage_progress";

const SINGLE = "home";

const text = (id: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const box = (id: string, children: Node[]): Node => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  slots: { children },
});

const placing = (
  id: string,
  componentId: string,
  overrides?: Record<string, string>
): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...(overrides === undefined ? {} : { overrides }) },
});

const document = (
  kind: "page" | "component",
  nodes: Node[],
  envelope: Node = {}
) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
  ...envelope,
});

/** An exposure that lets a placement choose which component `nodeId` places. */
const picks = (nodeId: string) => ({
  exposed: [
    {
      id: "card",
      label: "Card",
      nodeId,
      propPath: "componentId",
      type: "text",
    },
  ],
});

/** The codes a refused write carries, or `[]` when it went through. */
async function refusalCodes(write: Promise<unknown>): Promise<string[]> {
  try {
    await write;
    return [];
  } catch (error) {
    const errors =
      (error as { publicData?: { errors?: { code: string }[] } }).publicData
        ?.errors ?? [];
    return errors.map(issue => issue.code);
  }
}

/**
 * A plugin depending on the page builder, so its `ctx.db` reaches the page
 * builder's tables, as the plugin's own reads do.
 */
function probePlugin(holder: { db?: UsageDb }): PluginDefinition {
  return definePlugin({
    name: "@test/usage-index-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      holder.db = ctx.db;
    },
  });
}

/** The plugin's own backfill job and health service, as it contributes them. */
function installed(plugin: PluginDefinition) {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === USAGE_BACKFILL_JOB
  );
  const service = plugin.contributes?.services?.[USAGE_HEALTH_SERVICE]?.() as
    | UsageHealthService
    | undefined;
  if (job === undefined || service === undefined) {
    throw new Error("the page builder contributed no backfill job or health");
  }
  return {
    /** One tick of the sweep. */
    tick: () =>
      job.handler(
        null as never,
        {
          user: null,
          now: new Date(),
          deadline: new Date(Date.now() + 60_000),
          content: {},
        } as never
      ),
    service,
    /** "Used on N pages" for one component, as the library asks it. */
    count: async (componentId: string) =>
      componentUsageCount({
        read: service.counts(componentUsageIndex),
        componentId,
        health: await service.read(componentUsageIndex),
      }),
  };
}

describe.each(getConfiguredTestDialects())(
  "the usage index counts every host (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /**
     * A site with a blocks-backed Single, and a small depth limit; the
     * Single's blocks field takes `contentDefault` as its default when given.
     */
    async function boot(
      limits: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 4 },
      contentDefault?: () => unknown
    ) {
      const options = { limits };
      const plugin = pageBuilder(options);
      current = await createTestNextly({
        dialect,
        plugins: [plugin, probePlugin(probe)],
        singles: [
          {
            slug: SINGLE,
            fields: [
              { name: "title", type: "text" },
              {
                name: "content",
                type: BLOCKS_TYPE,
                ...(contentDefault === undefined
                  ? {}
                  : { defaultValue: contentDefault }),
              },
            ],
          } as never,
        ],
      });
      return { t: current, options, ...installed(plugin) };
    }

    /** The page builder's database, as a plugin depending on it reaches it. */
    const probe: { db?: UsageDb } = {};

    async function component(
      t: TestNextly,
      slug: string,
      nodes: Node[],
      envelope: Node = {}
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: slug,
          slug,
          status: "published",
          content: document("component", nodes, envelope),
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function page(t: TestNextly, nodes: Node[]): Promise<string> {
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Page",
          slug: `page-${String(Math.random()).slice(2, 10)}`,
          content: document("page", nodes),
        },
        overrideAccess: true,
      });
      await t.events.settle();
      return String(created.item.id);
    }

    async function single(t: TestNextly, nodes: Node[]): Promise<void> {
      await t.nextly.updateSingle({
        slug: SINGLE,
        data: {
          title: "Home",
          content: document("page", nodes),
          _overwrite: true,
        },
        overrideAccess: true,
      });
      await t.events.settle();
    }

    /** Deepen a component by one level, as an author's save would. */
    function deepen(t: TestNextly, id: string) {
      return t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: {
          status: "published",
          content: document("component", [
            box("d1", [box("d2", [text("d3")])]),
          ]),
          _overwrite: true,
        },
        overrideAccess: true,
      });
    }

    /** Every document the component index says places `componentId`, as `scope:entity:key`. */
    async function placers(t: TestNextly, componentId: string) {
      const rows = await t.adapter.select<Record<string, unknown>>(
        COMPONENT_ROWS,
        {
          where: {
            and: [
              { column: "componentId", op: "=", value: componentId },
              { column: "kind", op: "=", value: "reference" },
            ],
          },
        }
      );
      return [
        ...new Set(
          rows.map(
            row =>
              `${String(row.scope)}:${String(row.entity)}:${String(row.entityKey)}`
          )
        ),
      ].sort();
    }

    describe("a Single that places a component", () => {
      it("is counted, and found by the backfill once its rows are gone", async () => {
        const { t, tick, count } = await boot();
        const header = await component(t, "header", [text("h")]);
        await single(t, [placing("i1", header)]);

        expect(await placers(t, header)).toEqual([`single:${SINGLE}:`]);

        // Removed as a site installing over existing content has none, so
        // only the backfill's walk of the Single can put them back.
        await t.adapter.delete(COMPONENT_ROWS, {
          and: [{ column: "scope", op: "=", value: "single" }],
        });
        await tick();

        expect(await placers(t, header)).toEqual([`single:${SINGLE}:`]);
        // Whole: the Single's scopes were walked like a collection's.
        expect(await count(header)).toEqual({ documents: 1, complete: true });
      });

      it("forgets the rows of a Single that is gone, and keeps a live one's", async () => {
        const { t, tick, count } = await boot();
        const header = await component(t, "header", [text("h")]);
        await single(t, [placing("i1", header)]);
        await tick();

        // As a Single removed from the configuration leaves them: rows no
        // scope that exists now names, so no walk visits them.
        for (const [entity, field] of [
          ["retired", "content"],
          [SINGLE, "sidebar"],
        ] as const) {
          await t.adapter.insert(COMPONENT_ROWS, {
            id: globalThis.crypto.randomUUID(),
            scope: "single",
            entity,
            entityKey: "",
            field,
            locale: "",
            variant: "published",
            kind: "reference",
            componentId: header,
          });
        }
        // And its scope recorded as walked by the current run, which would
        // read a Single that comes back under the same scope as walked.
        const retired = backfillScopeKey({
          scope: "single",
          entity: "retired",
          field: "content",
          locale: "",
          variant: "published",
        });
        const [run] = await t.adapter.select<{ token: string }>(RUNS, {});
        await t.adapter.insert(PROGRESS, {
          id: globalThis.crypto.randomUUID(),
          token: run!.token,
          scopeKey: retired,
          cursor: null,
          done: true,
        });
        const progressOfRetired = () =>
          t.adapter.select(PROGRESS, {
            where: { and: [{ column: "scopeKey", op: "=", value: retired }] },
          });
        expect(await progressOfRetired()).toHaveLength(1);
        const sidebar = () =>
          t.adapter.select(COMPONENT_ROWS, {
            where: { and: [{ column: "field", op: "=", value: "sidebar" }] },
          });
        expect(await placers(t, header)).toEqual([
          "single:home:",
          "single:retired:",
        ]);
        expect(await sidebar()).toHaveLength(1);

        await tick();

        // CONTROL: the live Single's row, in the field it does store, stays.
        expect(await placers(t, header)).toEqual([`single:${SINGLE}:`]);
        expect(await sidebar()).toHaveLength(0);
        expect(await progressOfRetired()).toHaveLength(0);
        expect(await count(header)).toEqual({ documents: 1, complete: true });
      });

      it("is judged when the component it places deepens", async () => {
        const { t } = await boot();
        const deep = await component(t, "deep", [box("d1", [text("d2")])]);
        // Two deep, then the component two deep inside: the limit of four.
        await single(t, [box("p1", [box("p2", [placing("i1", deep)])])]);

        expect(await refusalCodes(deepen(t, deep))).toEqual([
          "COMPONENT_HOST_BROKEN",
        ]);
      });
    });

    describe("a component installed through an override", () => {
      it("counts the page whose placement installs it, and judges that page", async () => {
        const { t } = await boot();
        const deep = await component(t, "deep", [box("d1", [text("d2")])]);
        const plain = await component(t, "plain", [text("x")]);
        // `picker` places `plain` by default, and a placement may choose
        // another component through its `card` exposure.
        const picker = await component(
          t,
          "picker",
          [placing("n1", plain)],
          picks("n1")
        );
        const home = await page(t, [
          box("p1", [box("p2", [placing("i1", picker, { card: deep })])]),
        ]);

        // Nothing stored in the page or in `picker` names `deep`; the page's
        // override does.
        expect(await placers(t, deep)).toEqual([`collection:pages:${home}`]);
        // CONTROL: the components the documents store are recorded too.
        expect(await placers(t, picker)).toEqual([`collection:pages:${home}`]);

        expect(await refusalCodes(deepen(t, deep))).toEqual([
          "COMPONENT_HOST_BROKEN",
        ]);
      });

      it("counts the definition whose variant installs it", async () => {
        const { t } = await boot();
        const deep = await component(t, "deep", [text("d")]);
        const plain = await component(t, "plain", [text("x")]);
        const picker = await component(t, "picker", [placing("n1", plain)], {
          ...picks("n1"),
          variants: { deep: { label: "Deep", overrides: { card: deep } } },
        });

        expect(await placers(t, deep)).toEqual([
          `collection:${COMPONENTS_SLUG}:${picker}`,
        ]);
      });
    });

    describe("a run a failed write starts", () => {
      it("sweeps again, though the run before it had swept", async () => {
        const { t, tick, count } = await boot();
        const header = await component(t, "header", [text("h")]);
        const home = await page(t, [placing("i1", header)]);
        await tick();
        // Rows of a collection removed from the site, which no progress
        // names: left by a run that has swept, as its later passes read
        // nothing unless a scope it recorded is gone.
        await t.adapter.insert(COMPONENT_ROWS, {
          id: globalThis.crypto.randomUUID(),
          scope: "collection",
          entity: "retired-pages",
          entityKey: "p9",
          field: "content",
          locale: "",
          variant: "published",
          kind: "reference",
          componentId: header,
        });
        await tick();
        expect(await placers(t, header)).toEqual([
          `collection:pages:${home}`,
          "collection:retired-pages:p9",
        ]);

        // A failed write marks the index dirty and starts a new run, whose
        // progress, the record of the sweep with it, starts empty.
        await usageBookkeeping(
          probe.db!,
          dialect as Parameters<typeof usageBookkeeping>[1]
        ).markDirty();
        await tick();

        expect(await placers(t, header)).toEqual([`collection:pages:${home}`]);
        expect(await count(header)).toEqual({ documents: 1, complete: true });
      });
    });

    describe("a Single nobody has saved, whose defaults place a component and a style", () => {
      it("is counted from its defaults, and stays counted once a first read stores them", async () => {
        // The default is computed when a read builds it, by which time the
        // component it places exists.
        const placed: { header?: string } = {};
        const { t, tick, count, service } = await boot(undefined, () =>
          document("page", [
            placing("i1", placed.header ?? "not-yet"),
            { ...text("t1"), classes: ["c-card"] },
          ])
        );
        const header = await component(t, "header", [text("h")]);
        placed.header = header;
        const stored = () => t.adapter.select(`single_${SINGLE}`, {});
        const styled = async () =>
          (
            await t.adapter.select<Record<string, unknown>>(CLASS_ROWS, {
              where: {
                and: [{ column: "classId", op: "=", value: "c-card" }],
              },
            })
          ).map(row => `${String(row.scope)}:${String(row.entity)}`);
        expect(await stored()).toHaveLength(0);

        await tick();

        expect(await placers(t, header)).toEqual([`single:${SINGLE}:`]);
        expect([...new Set(await styled())]).toEqual([`single:${SINGLE}`]);
        expect(await count(header)).toEqual({ documents: 1, complete: true });
        expect(indexIsWhole(await service.read(classUsageIndex))).toBe(true);
        // Indexing the default stored nothing.
        expect(await stored()).toHaveLength(0);

        // A first ordinary read stores the default, which no save hook sees.
        await t.nextly.findSingle({ slug: SINGLE, overrideAccess: true });
        expect(await stored()).toHaveLength(1);
        await tick();

        expect(await placers(t, header)).toEqual([`single:${SINGLE}:`]);
        expect([...new Set(await styled())]).toEqual([`single:${SINGLE}`]);
        expect(await count(header)).toEqual({ documents: 1, complete: true });
      });
    });

    describe("a collection's scope that is gone", () => {
      it("forgets its rows and progress, whichever pass finds them, and the count drops", async () => {
        const { t, tick, count } = await boot();
        const header = await component(t, "header", [text("h")]);
        const home = await page(t, [placing("i1", header)]);
        /** A row placing `header`, filed under a collection scope. */
        const row = (entity: string, entityKey: string, locale: string) =>
          t.adapter.insert(COMPONENT_ROWS, {
            id: globalThis.crypto.randomUUID(),
            scope: "collection",
            entity,
            entityKey,
            field: "content",
            locale,
            variant: "published",
            kind: "reference",
            componentId: header,
          });
        // A collection removed from the site before the run walked it: no
        // progress names its rows, so the pass that finishes the run reads
        // the tables for them.
        await row("retired-pages", "p9", "");
        expect(await placers(t, header)).toEqual([
          `collection:pages:${home}`,
          "collection:retired-pages:p9",
        ]);

        await tick();

        expect(await placers(t, header)).toEqual([`collection:pages:${home}`]);

        // A language the field is no longer stored in, which the finished run
        // recorded as walked: a later pass finds it from that progress.
        await row("pages", "p8", "fr");
        const french = backfillScopeKey({
          scope: "collection",
          entity: "pages",
          field: "content",
          locale: "fr",
          variant: "published",
        });
        const [run] = await t.adapter.select<{ token: string }>(RUNS, {});
        await t.adapter.insert(PROGRESS, {
          id: globalThis.crypto.randomUUID(),
          token: run!.token,
          scopeKey: french,
          cursor: null,
          done: true,
        });
        const progressOfFrench = () =>
          t.adapter.select(PROGRESS, {
            where: { and: [{ column: "scopeKey", op: "=", value: french }] },
          });
        expect((await count(header)).documents).toBe(2);

        await tick();

        expect(await placers(t, header)).toEqual([`collection:pages:${home}`]);
        expect(await progressOfFrench()).toHaveLength(0);
        // CONTROL: the live page's row stays, and the count is exact.
        expect(await count(header)).toEqual({ documents: 1, complete: true });
      });
    });

    describe("reading the index a page at a time", () => {
      it("skips no row when a row of a page already read is removed", async () => {
        const { t } = await boot();
        const ids = ["r1", "r2", "r3", "r4", "r5"];
        for (const id of ids) {
          await t.adapter.insert(COMPONENT_ROWS, {
            id,
            scope: "collection",
            entity: "probe",
            entityKey: id,
            field: "content",
            locale: "",
            variant: "published",
            kind: "reference",
            componentId: "probed",
          });
        }
        const rows = usageTableRows(
          probe.db!,
          usageTableOf(componentUsageIndex),
          2
        );
        const where = { componentId: { equals: "probed" } };
        const seen: unknown[] = [];
        let after: string | undefined;
        for (let page = 1; page <= 5; page += 1) {
          const found = await rows({
            where,
            page,
            ...(after === undefined ? {} : { after }),
          });
          seen.push(...found.items.map(item => (item as { id: string }).id));
          after = (found.items.at(-1) as { id: string } | undefined)?.id;
          // A row of the page just read goes, as a concurrent save can make
          // it go, before the next page is asked for.
          if (page === 1) {
            await t.adapter.delete(COMPONENT_ROWS, {
              and: [{ column: "id", op: "=", value: "r1" }],
            });
          }
          if (!found.hasNext) break;
        }

        expect(seen).toEqual(ids);
      });
    });

    describe("a placement's text too long to be a component id", () => {
      it("is left out, so the save, the backfill and health all succeed", async () => {
        const { t, tick, service } = await boot();
        const plain = await component(t, "plain", [text("x")]);
        const picker = await component(
          t,
          "picker",
          [placing("n1", plain)],
          picks("n1")
        );
        const long = "x".repeat(600);
        const home = await page(t, [placing("i1", picker, { card: long })]);
        await tick();

        const health = await service.read(componentUsageIndex);
        expect({ whole: indexIsWhole(health), dirty: health.dirty }).toEqual({
          whole: true,
          dirty: false,
        });
        // CONTROL: the page's real component is recorded.
        expect(await placers(t, picker)).toEqual([`collection:pages:${home}`]);
        expect(await placers(t, long)).toEqual([]);
      });
    });

    describe("an existing site upgrading", () => {
      it("reads as not whole until every scope is walked into the new tables", async () => {
        const { t, tick, count } = await boot();
        const header = await component(t, "header", [text("h")]);
        const home = await page(t, [placing("i1", header)]);
        await tick();
        // CONTROL: walked under this version, the count is exact.
        expect(await count(header)).toEqual({ documents: 1, complete: true });

        // As the previous version left it: its run finished under the
        // derivation it knew, and the new tables empty. The rows it kept in
        // the retired collection are still there, and nothing reads them.
        const [run] = await t.adapter.select<{ generation: string }>(RUNS, {});
        await t.adapter.update(
          RUNS,
          { generation: run!.generation.replace(/^\d+\|/, "1|") },
          { and: [{ column: "name", op: "=", value: "usage" }] }
        );
        await t.adapter.delete(COMPONENT_ROWS, {
          and: [{ column: "entity", op: "=", value: "pages" }],
        });
        await t.nextly.create({
          collection: COMPONENT_USAGE_INDEX_SLUG,
          data: {
            scope: "collection",
            entity: "pages",
            entityKey: home,
            field: "content",
            locale: "",
            variant: "published",
            kind: "reference",
            componentId: header,
          },
          overrideAccess: true,
        });

        expect(await count(header)).toEqual({ documents: 0, complete: false });

        await tick();

        expect(await placers(t, header)).toEqual([`collection:pages:${home}`]);
        expect(await count(header)).toEqual({ documents: 1, complete: true });
      });

      it("never reads progress missing a scope as exact", async () => {
        const { t, tick, service } = await boot();
        const header = await component(t, "header", [text("h")]);
        await single(t, [placing("i1", header)]);
        await tick();
        // CONTROL: every scope walked, so whole.
        expect(indexIsWhole(await service.read(componentUsageIndex))).toBe(
          true
        );

        // The Single's scope is no longer recorded walked.
        await t.adapter.delete(PROGRESS, {
          and: [
            {
              column: "scopeKey",
              op: "=",
              value: backfillScopeKey({
                scope: "single",
                entity: SINGLE,
                field: "content",
                locale: "",
                variant: "published",
              }),
            },
          ],
        });

        expect(indexIsWhole(await service.read(componentUsageIndex))).toBe(
          false
        );
        // And the rows are no collection, so no Direct API call writes them.
        await expect(
          t.nextly.create({
            collection: COMPONENT_ROWS,
            data: { componentId: header },
            overrideAccess: true,
          })
        ).rejects.toThrow();
      });
    });

    describe("a full rebuild", () => {
      it("restores a row a concurrent save dropped", async () => {
        const { t, tick, options } = await boot();
        const header = await component(t, "header", [text("h")]);
        const home = await page(t, [placing("i1", header)]);
        await tick();

        // Dropped as two concurrent saves of the page can drop it, which
        // leaves nothing marked.
        await t.adapter.delete(COMPONENT_ROWS, {
          and: [{ column: "entityKey", op: "=", value: home }],
        });
        expect(await placers(t, header)).toEqual([]);

        // A full rebuild: the bounds move, which starts a run over every scope.
        options.limits = {
          ...options.limits,
          maxBytes: options.limits.maxBytes + 1,
        };
        await tick();

        expect(await placers(t, header)).toEqual([`collection:pages:${home}`]);
      });
    });
  }
);

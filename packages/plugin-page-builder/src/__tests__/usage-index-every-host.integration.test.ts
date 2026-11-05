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
import type { PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENT_USAGE_INDEX_SLUG } from "../collections/component-usage-index";
import { COMPONENTS_SLUG } from "../collections/components";
import { componentUsageCount, componentUsageIndex } from "../component-usage";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";
import { backfillScopeKey } from "../usage-backfill-scope";
import {
  USAGE_HEALTH_SERVICE,
  type UsageHealthService,
} from "../usage-health-service";
import { indexIsWhole } from "../usage-index-health";

type Node = Record<string, unknown>;

/** Where the component index's rows live. */
const COMPONENT_ROWS = "page_builder__component_usage";
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

    /** A site with a blocks-backed Single, and a small depth limit. */
    async function boot(
      limits: DocumentLimits = { ...DEFAULT_LIMITS, maxDepth: 4 }
    ) {
      const options = { limits };
      const plugin = pageBuilder(options);
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        singles: [
          {
            slug: SINGLE,
            fields: [
              { name: "title", type: "text" },
              { name: "content", type: BLOCKS_TYPE },
            ],
          } as never,
        ],
      });
      return { t: current, options, ...installed(plugin) };
    }

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
        data: { title: "Home", content: document("page", nodes) },
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
        },
        overrideAccess: true,
      });
    }

    /** Every document the component index says places `componentId`, as `scope:entity:key`. */
    async function placers(t: TestNextly, componentId: string) {
      const rows = await t.adapter.select<Record<string, unknown>>(
        COMPONENT_ROWS,
        {
          and: [
            { column: "componentId", op: "=", value: componentId },
            { column: "kind", op: "=", value: "reference" },
          ],
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
        const named = (keys: string[]) =>
          keys.map(key =>
            key
              .replace(deep, "deep")
              .replace(plain, "plain")
              .replace(picker, "picker")
          );
        expect(named(await placers(t, deep))).toEqual([
          `collection:pages:${home}`,
        ]);
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

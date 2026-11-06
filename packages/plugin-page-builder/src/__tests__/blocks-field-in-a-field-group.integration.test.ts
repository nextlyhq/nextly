/**
 * A blocks field inside a field-group instance is judged for composition as
 * the field on the document itself is: with the write it is part of, on that
 * write's connection.
 *
 * A field-group instance is validated by the field-group write, after its
 * host's row. Handed no write, the blocks field's validator cannot read the
 * component library, so a page could place a component past the depth limit
 * through a field group and be stored. With the write, one hole needs closing:
 * the lock baseline reads the stored field by the host's id and the field's
 * name, which inside an instance would be the host's own top-level field of
 * the same name, a different document. That read is refused, so the instance's
 * locks are judged against its starting blocks alone and fail closed.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  expandSlotDefaults,
  hasBlock,
  makeNode,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "nextly/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const heading = (id: string): Node => ({
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

const placing = (id: string, componentId: string): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const pageOf = (nodes: unknown[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A blocks field, as code declares one. */
const blocks = (name: string) => ({ name, type: BLOCKS_TYPE }) as never;

/** A card whose body only takes content, for the lock case. */
function registerSealedCard(): void {
  if (hasBlock("fg/sealed-card")) return;
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };
  registerBlocks(
    [
      {
        ...base,
        name: "fg/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: { text: "Title", align: "left" },
      },
      {
        ...base,
        name: "fg/sealed-card",
        slots: {
          body: {
            defaultBlock: [{ type: "fg/headline" }],
            lock: "contentOnly",
          },
        },
      },
    ] as never,
    { source: "test" } as never
  );
}

function sealedCard(align: string): BlockNode {
  const card = makeNode(
    "fg/sealed-card",
    1,
    {},
    expandSlotDefaults(
      "fg/sealed-card",
      registryBlockSource(),
      registryNestingSource()
    )
  );
  card.slots!.body![0]!.props.align = align;
  return card;
}

/**
 * The validation issue codes a refused write carries, or none for a write
 * that saved. Any other failure is rethrown, so a write that failed for
 * another reason never reads as a save.
 */
async function refusalCodes(write: Promise<unknown>): Promise<string[]> {
  try {
    await write;
    return [];
  } catch (error) {
    const errors = (
      error as { publicData?: { errors?: Array<{ code: string }> } }
    ).publicData?.errors;
    if (errors === undefined) throw error;
    return errors.map(issue => issue.code);
  }
}

/**
 * A component published two deep, with a pending draft one deep: which form a
 * save is judged against decides whether a page placing it fits.
 */
async function seedSwing(t: TestNextly): Promise<string> {
  const swinging = await t.nextly.create({
    collection: COMPONENTS_SLUG,
    data: {
      title: "swing",
      slug: "swing",
      status: "published",
      content: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "component",
        nodes: [box("s1", [heading("s2")])],
      },
    },
    overrideAccess: true,
  });
  const id = String(swinging.item.id);
  await t.nextly.update({
    collection: COMPONENTS_SLUG,
    id,
    data: {
      content: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "component",
        nodes: [heading("s1")],
      },
      _overwrite: true,
    },
    overrideAccess: true,
  });
  return id;
}

/** Three boxes deep around a placing: past the limit only in its published form. */
const pagePlacing = (componentId: string) =>
  pageOf([box("p1", [box("p2", [box("p3", [placing("i1", componentId)])])])]);

describe.each(getConfiguredTestDialects())(
  "a blocks field inside a field-group instance (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let deep = "";
    let swing = "";

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        // A small depth limit, so a too-deep page stays short.
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
        fieldGroups: [
          defineFieldGroup({
            slug: "herobox",
            fields: [text({ name: "title" }), blocks("content")],
          }),
        ],
        collections: [
          defineCollection({
            // With a lifecycle, so a save says whether it publishes.
            slug: "posters",
            status: true,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "hero", component: "herobox" }),
            ],
          }),
          defineCollection({
            slug: "landings",
            fields: [
              text({ name: "title" }),
              // The host's own blocks field, named as the instance's is.
              blocks("content"),
              fieldGroup({ name: "hero", component: "herobox" }),
              fieldGroup({
                name: "bands",
                component: "herobox",
                repeatable: true,
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "homeblock",
            fields: [
              // The single's own blocks field, named as the instance's is.
              blocks("content"),
              fieldGroup({ name: "hero", component: "herobox" }),
            ],
          }),
        ],
      });
      registerSealedCard();
      // Two deep on its own: placed under three boxes it reaches five.
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "deep",
          slug: "deep",
          content: {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [box("d1", [heading("d2")])],
          },
        },
        overrideAccess: true,
      });
      deep = String(created.item.id);
      swing = await seedSwing(t);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    const tooDeep = () =>
      pageOf([box("p1", [box("p2", [box("p3", [placing("i1", deep)])])])]);
    const withinLimit = () =>
      pageOf([box("p1", [box("p2", [placing("i1", deep)])])]);

    const createLanding = (data: Record<string, unknown>) =>
      t.nextly.create({
        collection: "landings" as never,
        data: { title: "Landing", ...data } as never,
        overrideAccess: true,
      });

    it("refuses an instance whose blocks compose past the depth limit, and saves one within it", async () => {
      expect(
        await refusalCodes(createLanding({ hero: { content: tooDeep() } }))
      ).toEqual(["depth-exceeded"]);

      // CONTROL: one level higher ends exactly at the limit.
      expect(
        await refusalCodes(createLanding({ hero: { content: withinLimit() } }))
      ).toEqual([]);
    });

    it("judges a publish against the published forms of the components it places", async () => {
      // Three boxes deep: the swing's published form (two deep) passes the
      // limit, its pending draft (one deep) ends at it.
      const page = () => pagePlacing(swing);
      const save = (status: string) =>
        t.nextly.create({
          collection: "posters" as never,
          data: { title: "Poster", status, hero: { content: page() } } as never,
          overrideAccess: true,
        });

      expect(await refusalCodes(save("published"))).toEqual(["depth-exceeded"]);
      // CONTROL: a draft is judged against the drafts alone, and fits.
      expect(await refusalCodes(save("draft"))).toEqual([]);
    });

    it("refuses the same on an update", async () => {
      const landing = await createLanding({});
      expect(
        await refusalCodes(
          t.nextly.update({
            collection: "landings" as never,
            id: String(landing.item.id),
            data: { hero: { content: tooDeep() }, _overwrite: true } as never,
            overrideAccess: true,
          })
        )
      ).toEqual(["depth-exceeded"]);
    });

    it("refuses the same in a repeatable instance", async () => {
      expect(
        await refusalCodes(
          createLanding({
            bands: [{ content: withinLimit() }, { content: tooDeep() }],
          })
        )
      ).toEqual(["depth-exceeded"]);
    });

    it("refuses the same in a Single's instance", async () => {
      expect(
        await refusalCodes(
          t.nextly.updateSingle({
            slug: "homeblock" as never,
            data: { hero: { content: tooDeep() }, _overwrite: true } as never,
          })
        )
      ).toEqual(["depth-exceeded"]);
    });

    it("judges an instance's locks against its own starting blocks, not the host's field of the same name", async () => {
      // The host's own field holds a card loosened past its lock, as an older
      // writer could have left it: planted past every check.
      const landing = await createLanding({});
      const id = String(landing.item.id);
      // One card, the same ids in both places, so the host's could stand in
      // as the instance's baseline.
      const card = sealedCard("right");
      const loosened = pageOf([card]);
      await t.adapter.update(
        "dc_landings",
        {
          content: dialect === "sqlite" ? JSON.stringify(loosened) : loosened,
        },
        { and: [{ column: "id", op: "=", value: id }] }
      );

      // The same loosening inside the instance: had the instance's lock read
      // the host's field as its baseline, it would pass as unchanged.
      expect(
        await refusalCodes(
          t.nextly.update({
            collection: "landings" as never,
            id,
            data: {
              hero: { content: pageOf([card]) },
              _overwrite: true,
            } as never,
            overrideAccess: true,
          })
        )
      ).toEqual(["locked-slot-content-only"]);
    });

    it("judges a Single's instance's locks against its own starting blocks, not the Single's field of the same name", async () => {
      await t.nextly.updateSingle({
        slug: "homeblock" as never,
        data: { hero: { title: "Hero" }, _overwrite: true } as never,
      });
      const [row] = await t.adapter.select<{ id: string }>("single_homeblock");
      // The single's own field holds a card loosened past its lock: planted
      // past every check, as for the collection case above.
      const card = sealedCard("right");
      const loosened = pageOf([card]);
      await t.adapter.update(
        "single_homeblock",
        {
          content: dialect === "sqlite" ? JSON.stringify(loosened) : loosened,
        },
        { and: [{ column: "id", op: "=", value: row!.id }] }
      );

      expect(
        await refusalCodes(
          t.nextly.updateSingle({
            slug: "homeblock" as never,
            data: {
              hero: { content: pageOf([card]) },
              _overwrite: true,
            } as never,
          })
        )
      ).toEqual(["locked-slot-content-only"]);
    });

    it("refuses an existing instance whose locked child left its starting design, until it is brought back", async () => {
      // An instance stored before its blocks were judged, holding a card
      // loosened past its lock: planted in the instance's own row.
      const landing = await createLanding({ hero: { title: "Hero" } });
      const id = String(landing.item.id);
      const card = sealedCard("right");
      const loosened = pageOf([card]);
      await t.adapter.update(
        "comp_herobox",
        {
          content: dialect === "sqlite" ? JSON.stringify(loosened) : loosened,
        },
        {
          and: [
            { column: "_parent_id", op: "=", value: id },
            { column: "_parent_field", op: "=", value: "hero" },
          ],
        }
      );
      const stored = (await t.nextly.findByID({
        collection: "landings" as never,
        id,
        depth: 0,
        overrideAccess: true,
      })) as { hero?: { content?: unknown } };
      expect(stored.hero?.content).toEqual(loosened);

      const save = () =>
        t.nextly.update({
          collection: "landings" as never,
          id,
          data: {
            hero: { title: "Hero", content: pageOf([card]) },
            _overwrite: true,
          } as never,
          overrideAccess: true,
        });

      // The instance has no stored baseline of its own, so its next write is
      // judged against the card's starting design, not grandfathered.
      expect(await refusalCodes(save())).toEqual(["locked-slot-content-only"]);

      // Brought back to its starting design, it saves.
      card.slots!.body![0]!.props.align = "left";
      expect(await refusalCodes(save())).toEqual([]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a blocks field inside a field-group instance, in a translation (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let swing = "";

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
        fieldGroups: [
          defineFieldGroup({
            slug: "herobox",
            fields: [text({ name: "title" }), blocks("content")],
          }),
        ],
        collections: [
          {
            slug: "billboards",
            status: true,
            localized: true,
            fields: [
              { name: "title", type: "text", localized: true },
              fieldGroup({ name: "hero", component: "herobox" }),
            ],
          } as never,
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      swing = await seedSwing(t);
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("judges a German publish against the published forms of the components it places", async () => {
      const created = await t.nextly.create({
        collection: "billboards" as never,
        data: { title: "Board", status: "draft" } as never,
        overrideAccess: true,
      });
      const id = String(created.item.id);
      // In German, the status this write leaves is the language's own, kept
      // apart from the row; the field group's validators are still told it.
      const save = (status: string) =>
        t.nextly.update({
          collection: "billboards" as never,
          id,
          locale: "de",
          data: {
            title: "Tafel",
            status,
            hero: { content: pagePlacing(swing) },
            _overwrite: true,
          } as never,
          overrideAccess: true,
        });

      expect(await refusalCodes(save("published"))).toEqual(["depth-exceeded"]);
      // CONTROL: a German draft is judged against the drafts alone, and fits.
      expect(await refusalCodes(save("draft"))).toEqual([]);
    });
  }
);

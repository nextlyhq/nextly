/**
 * A block locked in Layers holds against every write through the API.
 *
 * The engine suites judge a write against a stored document held in memory.
 * What only a server can show is that the save reads the document it would
 * replace and asks: a page stored with a locked block, then updated through
 * the Direct API that a REST request and an agent both arrive through.
 *
 * The lock is a convenience, not a permission, so the same write lifting it
 * is the way past; and a translated field whose language store is not ready
 * yet is kept unjudged, which a database cannot be made to show on demand and
 * `fields/layers-lock-judgement.test.ts` pins instead.
 *
 * Per dialect, because the stored read runs on the adapter's own connection.
 *
 * @module __tests__/layers-lock.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { blocks } from "../fields/blocksHelper";
import { LAYERS_LOCK_CHANGED } from "../fields/layers-lock-wording";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown> & { id: string };

const heading = (id: string, extra: Record<string, unknown> = {}): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

const box = (
  id: string,
  children: Node[],
  extra: Record<string, unknown> = {}
): Node => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  slots: { children },
  ...extra,
});

const pageOf = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/**
 * The page as stored: a section holding a locked heading named "Hero" and a
 * free heading, then an empty section and a loose heading.
 */
function storedNodes(): Node[] {
  return [
    box("section", [
      heading("hero", { locked: true, name: "Hero" }),
      heading("free"),
    ]),
    box("other", []),
    heading("loose"),
  ];
}

/** The stored page with `edit` applied to a copy, as a writer sends it. */
function edited(edit: (nodes: Node[]) => void) {
  const nodes = structuredClone(storedNodes());
  edit(nodes);
  return pageOf(nodes);
}

const childrenOf = (node: Node) =>
  (node.slots as { children: Node[] }).children;

function issuesOf(
  error: unknown
): Array<{ path: string; code: string; message: string }> {
  return (
    (
      error as {
        publicData?: {
          errors?: Array<{ path: string; code: string; message: string }>;
        };
      }
    ).publicData?.errors ?? []
  );
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe.each(getConfiguredTestDialects())(
  "a Layers lock on every API write (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** A stored page with the locked block, and an update of its content. */
    async function storedPage(nodes: Node[] = storedNodes()) {
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const t = current;
      const saved = await t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: `home-${String(Math.random()).slice(2, 8)}`,
          content: pageOf(nodes),
        },
        overrideAccess: true,
      });
      const id = String(saved.item.id);
      const update = (content: unknown) =>
        t.nextly.update({
          collection: "pages",
          id,
          data: { content, _overwrite: true },
          overrideAccess: true,
        });
      const read = async () =>
        (
          (await t.nextly.findByID({
            collection: "pages",
            id,
            overrideAccess: true,
          })) as unknown as { content: { nodes: Node[] } | null }
        ).content as { nodes: Node[] };
      return { update, read };
    }

    /** The one refusal a write meets: the lock's, naming the block. */
    async function expectRefusedNamingHero(write: Promise<unknown>) {
      const issues = issuesOf(await refusalOf(write));
      expect(issues).toEqual([
        expect.objectContaining({ path: "content", code: LAYERS_LOCK_CHANGED }),
      ]);
      expect(issues[0]!.message).toContain('"Hero" is locked in Layers');
    }

    it("refuses changing, moving or removing a locked block, naming it", async () => {
      const { update, read } = await storedPage();
      // CONTROL: the stored page sent back unchanged saves, so every refusal
      // below is the edit's, not the page's.
      await expect(update(pageOf(storedNodes()))).resolves.toBeDefined();

      await expectRefusedNamingHero(
        update(
          edited(nodes => {
            childrenOf(nodes[0]!)[0]!.props = { text: "Changed", level: 2 };
          })
        )
      );
      await expectRefusedNamingHero(
        update(
          edited(nodes => {
            childrenOf(nodes[0]!)[0]!.name = "Renamed";
          })
        )
      );
      await expectRefusedNamingHero(
        update(
          edited(nodes => {
            const [hero] = childrenOf(nodes[0]!).splice(0, 1);
            childrenOf(nodes[1]!).push(hero!);
          })
        )
      );
      await expectRefusedNamingHero(
        update(
          edited(nodes => {
            childrenOf(nodes[0]!).splice(0, 1);
          })
        )
      );
      // Nothing refused was stored.
      expect((await read()).nodes).toEqual(pageOf(storedNodes()).nodes);
    });

    it("refuses moving or deleting the UNLOCKED block that holds it", async () => {
      const { update } = await storedPage();
      await expectRefusedNamingHero(
        update(
          edited(nodes => {
            const [section] = nodes.splice(0, 1);
            childrenOf(nodes[0]!).push(section!);
          })
        )
      );
      await expectRefusedNamingHero(
        update(
          edited(nodes => {
            nodes.splice(0, 1);
          })
        )
      );
    });

    it("refuses emptying the field of a page holding a locked block, and stores nothing", async () => {
      // A `null` never reaches the field's own validation, so this is the
      // write that would drop every locked block with nothing asked.
      const { update, read } = await storedPage();
      await expectRefusedNamingHero(update(null));
      expect((await read()).nodes).toEqual(pageOf(storedNodes()).nodes);
    });

    it("still empties the field of a page holding no locked block", async () => {
      // The control: the refusal above is the lock's, not a refusal of every
      // empty write.
      const unlocked = storedNodes();
      delete childrenOf(unlocked[0]!)[0]!.locked;
      const { update, read } = await storedPage(unlocked);
      await expect(update(null)).resolves.toBeDefined();
      expect(await read()).toBeNull();
    });

    it("refuses a field a LATER hook empties on a page holding a locked block", async () => {
      // A collection's own `beforeUpdate` hook runs after any registered for
      // every collection, so the field is judged on the data the hooks leave,
      // where every other rule is judged.
      const { update, read } = await storedPage();
      current!.hooks.register("beforeUpdate", "pages", async context => {
        const data = (context as { data?: Record<string, unknown> }).data;
        return data === undefined ? undefined : { ...data, content: null };
      });
      await expectRefusedNamingHero(update(pageOf(storedNodes())));
      expect((await read()).nodes).toEqual(pageOf(storedNodes()).nodes);
    });

    it("refuses emptying a Single's field that holds a locked block", async () => {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        singles: [
          { slug: "home", fields: [blocks({ name: "content" })] } as never,
        ],
      });
      const t = current;
      const save = (content: unknown) =>
        t.nextly.updateSingle({
          slug: "home",
          data: { content, _overwrite: true },
          overrideAccess: true,
        } as never);
      await save(pageOf(storedNodes()));
      await expectRefusedNamingHero(save(null));
    });

    it("refuses an import that skips hooks and empties the field", async () => {
      await storedPage();
      const t = current!;
      const [page] = (
        await t.nextly.find({ collection: "pages", overrideAccess: true })
      ).items as Array<{ id: string | number }>;
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): {
            updateEntries(
              params: { collectionName: string; overrideAccess?: boolean },
              entries: { id: string; data: Record<string, unknown> }[],
              options?: { skipHooks?: boolean }
            ): Promise<{ successful: number; failed: number }>;
          };
        }
      ).getEntryService();

      const result = await entries.updateEntries(
        { collectionName: "pages", overrideAccess: true },
        [{ id: String(page!.id), data: { content: null, _overwrite: true } }],
        { skipHooks: true }
      );

      expect(result.failed, JSON.stringify(result)).toBe(1);
    });

    it("accepts a change that leaves the locked block where and as it is", async () => {
      const { update, read } = await storedPage();
      // A block added before it shifts its index, not its place; the section
      // around it and the free block beside it are not inside the lock.
      await expect(
        update(
          edited(nodes => {
            childrenOf(nodes[0]!).unshift(heading("added"));
            nodes[0]!.props = { gap: "large" };
            childrenOf(nodes[0]!)[2]!.props = { text: "Free", level: 3 };
          })
        )
      ).resolves.toBeDefined();
      expect(childrenOf((await read()).nodes[0]!).map(node => node.id)).toEqual(
        ["added", "hero", "free"]
      );
    });

    it("accepts a write that changes only a lock, either way", async () => {
      const { update, read } = await storedPage();
      await expect(
        update(
          edited(nodes => {
            delete childrenOf(nodes[0]!)[0]!.locked;
          })
        )
      ).resolves.toBeDefined();
      expect(childrenOf((await read()).nodes[0]!)[0]!.locked).toBeUndefined();
      await expect(update(pageOf(storedNodes()))).resolves.toBeDefined();
      expect(childrenOf((await read()).nodes[0]!)[0]!.locked).toBe(true);
    });

    it("accepts unlocking a block and changing it in the same write", async () => {
      const { update, read } = await storedPage();
      await expect(
        update(
          edited(nodes => {
            const [hero] = childrenOf(nodes[0]!).splice(0, 1);
            delete hero!.locked;
            hero!.props = { text: "Changed", level: 1 };
            childrenOf(nodes[1]!).push(hero!);
          })
        )
      ).resolves.toBeDefined();
      const stored = await read();
      expect(childrenOf(stored.nodes[1]!)[0]).toEqual(
        expect.objectContaining({
          id: "hero",
          props: { text: "Changed", level: 1 },
        })
      );
      // And the write after it is judged against what that write stored: the
      // block is no longer locked, so changing it again needs no unlock.
      const again = structuredClone(stored.nodes);
      childrenOf(again[1]!)[0]!.props = { text: "Again", level: 1 };
      await expect(update(pageOf(again))).resolves.toBeDefined();
    });

    describe("a block locked inside a component a page places", () => {
      /**
       * A published component holding a locked "Hero" heading and a free one,
       * each exposed to its placements through a text field.
       */
      async function promo(
        t: TestNextly,
        { slug = "promo", heroText = "hero", exposeHeroVisibility = false } = {}
      ): Promise<string> {
        const created = await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Promo",
            slug,
            content: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [
                heading("hero", {
                  locked: true,
                  name: "Hero",
                  props: { text: heroText, level: 2 },
                }),
                heading("sub"),
              ],
              exposed: [
                ...(exposeHeroVisibility
                  ? [
                      {
                        id: "showHero",
                        label: "Show hero",
                        nodeId: "hero",
                        propPath: "visibility",
                        type: "visibility",
                      },
                    ]
                  : []),
                {
                  id: "title",
                  label: "Title",
                  nodeId: "hero",
                  propPath: "text",
                  type: "text",
                },
                {
                  id: "subtitle",
                  label: "Subtitle",
                  nodeId: "sub",
                  propPath: "text",
                  type: "text",
                },
              ],
            },
            status: "published",
          },
          overrideAccess: true,
        });
        return String(created.item.id);
      }

      const placing = (componentId: string, overrides?: object): Node => ({
        id: "i1",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: {
          componentId,
          ...(overrides === undefined ? {} : { overrides }),
        },
      });

      it("refuses a placement's value that changes the locked block, naming it", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const id = await promo(t);
        const save = (nodes: Node[]) =>
          t.nextly.create({
            collection: "pages",
            data: {
              title: "Home",
              slug: `home-${String(Math.random()).slice(2, 8)}`,
              content: pageOf(nodes),
            },
            overrideAccess: true,
          });

        // CONTROL: placed as it is, and given a value for the free block, the
        // page saves; only the value reaching the locked block is refused.
        await expect(save([placing(id)])).resolves.toBeDefined();
        await expect(
          save([placing(id, { subtitle: "Spring sale" })])
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(
          save([placing(id, { title: "Changed" })])
        );
      });

      /** A page created with `nodes`, for a test that only creates pages. */
      const created = (t: TestNextly, nodes: Node[]) =>
        t.nextly.create({
          collection: "pages",
          data: {
            title: "Home",
            slug: `home-${String(Math.random()).slice(2, 8)}`,
            content: pageOf(nodes),
          },
          overrideAccess: true,
        });

      it("refuses a placement's value that hides every block the component locks", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const id = await promo(t, { exposeHeroVisibility: true });

        // CONTROL: shown, as the component holds it, the page saves. Hidden,
        // the locked block is gone from what the page composes, which is the
        // change the lock refuses.
        await expect(
          created(t, [placing(id, { showHero: true })])
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(
          created(t, [placing(id, { showHero: false })])
        );
      });

      it("refuses a value reaching the locked block of a component placed in another's slot", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const inner = await promo(t);
        // An outer component exposing one region, which the page fills with
        // the promo: the promo is the page's own placement, nested in the
        // outer one's slot.
        const frame = await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Frame",
            slug: "frame",
            content: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [box("well", [])],
              slots: {
                body: { label: "Body", nodeId: "well", slot: "children" },
              },
            },
            status: "published",
          },
          overrideAccess: true,
        });
        const framing = (nested: Node): Node => ({
          id: "o1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: String(frame.item.id) },
          slots: { body: [nested] },
        });

        await expect(
          created(t, [framing(placing(inner, { subtitle: "Spring sale" }))])
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(
          created(t, [framing(placing(inner, { title: "Changed" }))])
        );
      });

      it("refuses a placement switched to another component keeping the first one's value", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        // Two components whose locked blocks share an id, as a copy of one
        // does, and differ in what they hold.
        const first = await promo(t);
        const second = await promo(t, {
          slug: "promo-copy",
          heroText: "Held by the copy",
        });
        const saved = await created(t, [placing(first)]);
        const update = (nodes: Node[]) =>
          t.nextly.update({
            collection: "pages",
            id: String(saved.item.id),
            data: { content: pageOf(nodes), _overwrite: true },
            overrideAccess: true,
          });

        // The first component's value, given to the second: the stored page
        // drew it on a block of the same id, but under the first component's
        // lock, so it keeps nothing for the second.
        await expectRefusedNamingHero(
          update([placing(second, { title: "hero" })])
        );
        await expect(update([placing(second)])).resolves.toBeDefined();
      });

      it("refuses it on a placement a condition gates, which the page does not compose", async () => {
        // Visitors may read pages, so a condition on a page's title is one
        // the page can check for them.
        current = await createTestNextly({
          dialect,
          plugins: [pageBuilder()],
          seedPublic: true,
        });
        const t = current;
        const id = await promo(t);
        const gated = (overrides: object): Node => ({
          ...placing(id, overrides),
          visibility: {
            conditions: [[{ field: "title", op: "eq", value: "Home" }]],
          },
        });
        const save = (nodes: Node[]) =>
          t.nextly.create({
            collection: "pages",
            data: {
              title: "Home",
              slug: `home-${String(Math.random()).slice(2, 8)}`,
              content: pageOf(nodes),
            },
            overrideAccess: true,
          });

        // CONTROL: gated, and given a value for the free block, it saves.
        await expect(
          save([gated({ subtitle: "Spring sale" })])
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(save([gated({ title: "Changed" })]));
      });

      it("refuses an outer component's value relayed into it through a gated nested placement", async () => {
        // Visitors may read pages, so a condition on a page's title is one
        // the page can check for them.
        current = await createTestNextly({
          dialect,
          plugins: [pageBuilder()],
          seedPublic: true,
        });
        const t = current;
        const inner = await promo(t);
        // An outer component placing the promo under a condition, and exposing
        // the promo's own fields as its own, so a page reaches the locked
        // block only through the outer placement.
        const outer = await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Banner",
            slug: "banner",
            content: {
              formatVersion: DOCUMENT_FORMAT_VERSION,
              kind: "component",
              nodes: [
                {
                  id: "nested",
                  type: COMPONENT_INSTANCE_TYPE,
                  version: 1,
                  props: { componentId: inner },
                  visibility: {
                    conditions: [[{ field: "title", op: "eq", value: "Home" }]],
                  },
                },
              ],
              exposed: [
                {
                  id: "headline",
                  label: "Headline",
                  nodeId: "nested",
                  propPath: "overrides.title",
                  type: "text",
                },
                {
                  id: "strap",
                  label: "Strap",
                  nodeId: "nested",
                  propPath: "overrides.subtitle",
                  type: "text",
                },
              ],
            },
            status: "published",
          },
          overrideAccess: true,
        });
        const outerId = String(outer.item.id);
        const save = (nodes: Node[]) =>
          t.nextly.create({
            collection: "pages",
            data: {
              title: "Home",
              slug: `home-${String(Math.random()).slice(2, 8)}`,
              content: pageOf(nodes),
            },
            overrideAccess: true,
          });

        // CONTROL: a value relayed to the free block saves.
        await expect(
          save([placing(outerId, { strap: "Spring sale" })])
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(
          save([placing(outerId, { headline: "Changed" })])
        );
      });

      it("refuses a variant of the component that sets a value on the locked block", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const id = await promo(t);
        const stored = (await t.nextly.findByID({
          collection: COMPONENTS_SLUG,
          id,
          overrideAccess: true,
        })) as unknown as { content: Record<string, unknown> };
        const withVariant = (overrides: Record<string, string>) =>
          t.nextly.update({
            collection: COMPONENTS_SLUG,
            id,
            data: {
              content: {
                ...stored.content,
                variants: { dark: { label: "Dark", overrides } },
              },
              _overwrite: true,
            },
            overrideAccess: true,
          });

        // CONTROL: a variant setting the free block's value saves.
        await expect(
          withVariant({ subtitle: "Spring sale" })
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(withVariant({ title: "Changed" }));
      });

      /** The promo's content, with `edit` applied, for a create or an update. */
      function promoContent(
        variants: Record<string, Record<string, string>>,
        heroLocked = true
      ) {
        return {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [
            heading("hero", {
              name: "Hero",
              ...(heroLocked ? { locked: true } : {}),
            }),
            heading("sub"),
          ],
          exposed: [
            {
              id: "title",
              label: "Title",
              nodeId: "hero",
              propPath: "text",
              type: "text",
            },
            {
              id: "subtitle",
              label: "Subtitle",
              nodeId: "sub",
              propPath: "text",
              type: "text",
            },
          ],
          variants: Object.fromEntries(
            Object.entries(variants).map(([name, overrides]) => [
              name,
              { label: name, overrides },
            ])
          ),
        };
      }

      it("refuses creating a component whose variant sets a value on a block it locks", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const create = (slug: string, overrides: Record<string, string>) =>
          t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: slug,
              slug,
              content: promoContent({ dark: overrides }),
              status: "published",
            },
            overrideAccess: true,
          });

        await expect(
          create("free", { subtitle: "Sale" })
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(create("held", { title: "Changed" }));
      });

      it("refuses an update that locks a block an existing variant sets", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const created = await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Promo",
            slug: "promo",
            content: promoContent({ dark: { title: "Changed" } }, false),
            status: "published",
          },
          overrideAccess: true,
        });

        await expectRefusedNamingHero(
          t.nextly.update({
            collection: COMPONENTS_SLUG,
            id: String(created.item.id),
            data: {
              content: promoContent({ dark: { title: "Changed" } }),
              _overwrite: true,
            },
            overrideAccess: true,
          })
        );
      });

      it("refuses a variant reaching the locked block through a component it places", async () => {
        current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
        const t = current;
        const inner = await promo(t);
        const outer = (overrides: Record<string, string>, slug: string) =>
          t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: slug,
              slug,
              content: {
                formatVersion: DOCUMENT_FORMAT_VERSION,
                kind: "component",
                nodes: [
                  {
                    id: "nested",
                    type: COMPONENT_INSTANCE_TYPE,
                    version: 1,
                    props: { componentId: inner },
                  },
                ],
                exposed: [
                  {
                    id: "headline",
                    label: "Headline",
                    nodeId: "nested",
                    propPath: "overrides.title",
                    type: "text",
                  },
                  {
                    id: "strap",
                    label: "Strap",
                    nodeId: "nested",
                    propPath: "overrides.subtitle",
                    type: "text",
                  },
                ],
                variants: { loud: { label: "Loud", overrides } },
              },
              status: "published",
            },
            overrideAccess: true,
          });

        await expect(
          outer({ strap: "Sale" }, "free-banner")
        ).resolves.toBeDefined();
        await expectRefusedNamingHero(outer({ headline: "Changed" }, "banner"));
      });

      it("refuses it on an update too", async () => {
        const { update } = await storedPage([heading("loose")]);
        const id = await promo(current!);
        await expect(update(pageOf([placing(id)]))).resolves.toBeDefined();
        await expectRefusedNamingHero(
          update(pageOf([placing(id, { title: "Changed" })]))
        );
      });

      it("keeps a value the stored page gave the block before it was locked", async () => {
        const { update } = await storedPage([heading("loose")]);
        const t = current!;
        const id = await promo(t);
        const unlocked = (await t.nextly.findByID({
          collection: COMPONENTS_SLUG,
          id,
          overrideAccess: true,
        })) as unknown as { content: { nodes: Node[] } };
        const content = structuredClone(unlocked.content);
        delete content.nodes[0]!.locked;
        await t.nextly.update({
          collection: COMPONENTS_SLUG,
          id,
          data: { content, _overwrite: true },
          overrideAccess: true,
        });
        const given = pageOf([placing(id, { title: "Changed" })]);
        await expect(update(given)).resolves.toBeDefined();

        // The designer locks the block afterwards: the page keeps what it
        // stores, and only a new value for the block is refused.
        content.nodes[0]!.locked = true;
        await t.nextly.update({
          collection: COMPONENTS_SLUG,
          id,
          data: { content, _overwrite: true },
          overrideAccess: true,
        });
        await expect(update(given)).resolves.toBeDefined();
        await expectRefusedNamingHero(
          update(pageOf([placing(id, { title: "Changed again" })]))
        );
      });
    });
  }
);

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
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { LAYERS_LOCK_CHANGED } from "../fields/layers-lock-judgement";
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
          data: { content },
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
  }
);

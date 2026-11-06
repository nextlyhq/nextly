/**
 * Two writes made at once cannot each pass against the composition graph as
 * it stood before the other.
 *
 * Validation judges a write before its transaction opens, so the race is
 * real: both writes are judged against a library holding neither. What closes
 * it is the graph lock each takes inside its transaction, and the judgement
 * made again under it. Only a database shows that, and only with the two
 * writes interleaved on purpose: here the first write is held inside its
 * transaction, after it has taken the lock and been judged, until the second
 * has passed its validation; then it is let go.
 *
 * With the lock, the second write waits at it until the first commits, and is
 * then judged against what the first stored. Without it, the second is judged
 * against the graph as it stood before, commits, and the first commits after
 * it: both pass, and the graph holds a loop or a page past the depth limit.
 *
 * Per dialect, because the lock is the dialect's own. On SQLite the writer
 * lock already lets one transaction in at a time, so the second write is
 * judged after the first there whatever this plugin does.
 *
 * @module __tests__/composition-graph-lock.integration.test
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
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { text as textField } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

/** A Single holding a blocks field. */
const HOMEPAGE = "homepage";

/** The Singles service, as a Single's save reaches it. */
interface Singles {
  update(
    slug: string,
    data: Record<string, unknown>,
    options: { overrideAccess?: boolean }
  ): Promise<{ success: boolean }>;
}

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
 * A headline, and a hero whose one slot is locked to the two headlines it
 * starts with: nothing may be added to it, nor taken out.
 */
function registerLockedHero(): void {
  if (hasBlock("acme/locked-hero")) return;
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
        name: "acme/headline",
        props: { text: { type: "text", role: "content" } },
        defaultProps: { text: "Title" },
      },
      {
        ...base,
        name: "acme/locked-hero",
        slots: {
          content: {
            defaultBlock: [
              { type: "acme/headline" },
              { type: "acme/headline" },
            ],
            lock: "all",
          },
        },
      },
    ] as never,
    { source: "acme" }
  );
}

/** A block as inserting it places it, its slots filled with their defaults. */
function inserted(type: string): BlockNode {
  return makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
}

/** The issue codes a refused write carries. */
function codesOf(error: unknown): string[] {
  const issues =
    (error as { publicData?: { errors?: { code: string }[] } }).publicData
      ?.errors ?? [];
  return issues.map(issue => issue.code);
}

const pause = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/** The entry service's write inside a transaction its caller opened. */
interface CallerTransactionEntries {
  updateEntryInTransaction(
    tx: Parameters<Parameters<TestNextly["adapter"]["transaction"]>[0]>[0],
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
    },
    body: Record<string, unknown>
  ): Promise<{ success: boolean }>;
}

/**
 * Holds one write inside its transaction until let go, and says when a
 * marked write has passed its validation.
 */
interface Gate {
  /** The entry whose write is held, once it is set. */
  holdId: string | undefined;
  /** Resolved once the held write is waiting inside its transaction. */
  held: Promise<void>;
  /** Lets the held write go on to commit. */
  release: () => void;
  /** The text a write's data carries for {@link validated} to answer. */
  marker: string | undefined;
  /** Resolved once a write carrying {@link marker} passed its validation. */
  validated: Promise<void>;
}

function newGate(): Gate & {
  resolveHeld: () => void;
  resolveValidated: () => void;
  released: Promise<void>;
} {
  let resolveHeld = () => {};
  let resolveValidated = () => {};
  let release = () => {};
  const held = new Promise<void>(resolve => {
    resolveHeld = resolve;
  });
  const validated = new Promise<void>(resolve => {
    resolveValidated = resolve;
  });
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    holdId: undefined,
    held,
    release,
    released,
    marker: undefined,
    validated,
    resolveHeld,
    resolveValidated,
  };
}

/**
 * The plugin holding the gate. It depends on the page builder, so its
 * in-transaction handler runs after the page builder's: the held write has
 * taken the graph lock and been judged when it waits here.
 */
function gatePlugin(gate: ReturnType<typeof newGate>): PluginDefinition {
  return definePlugin({
    name: "@test/graph-lock-gate",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      ctx.hooks.onInTransaction("*", async write => {
        if (gate.holdId === undefined || write.id !== gate.holdId) return;
        gate.holdId = undefined;
        gate.resolveHeld();
        await gate.released;
      });
      // `beforeChange` runs after validation and before the transaction opens.
      ctx.hooks.on("beforeChange", "*", context => {
        const marker = gate.marker;
        if (
          marker !== undefined &&
          JSON.stringify(context.data).includes(marker)
        ) {
          gate.resolveValidated();
        }
        return undefined;
      });
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "the composition graph lock (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let gate = newGate();

    afterEach(async () => {
      gate.release();
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      gate = newGate();
      current = await createTestNextly({
        dialect,
        plugins: [
          pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } }),
          gatePlugin(gate),
        ],
        collections: [
          { slug: "notes", fields: [textField({ name: "title" })] } as never,
        ],
        singles: [
          {
            slug: HOMEPAGE,
            fields: [{ name: "content", type: BLOCKS_TYPE }],
          } as never,
        ],
      });
      return current;
    }

    async function component(t: TestNextly, slug: string, nodes: Node[]) {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: { title: slug, slug, content: document("component", nodes) },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    function setContent(t: TestNextly, id: string, nodes: Node[]) {
      return t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { content: document("component", nodes), _overwrite: true },
        overrideAccess: true,
      });
    }

    async function storedContent(t: TestNextly, id: string): Promise<string> {
      const row = await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id,
        depth: 0,
        status: "all",
        draft: true,
        overrideAccess: true,
      });
      return JSON.stringify((row as Record<string, unknown>).content);
    }

    /**
     * Run `first` held inside its transaction until `second` (carrying
     * `marker`) has passed its validation, then let `first` commit; both
     * settled. On SQLite the second write cannot pass its validation while
     * the first holds the one connection's transaction, so the gate lets go
     * after a while instead.
     */
    async function interleaved(
      holdId: string,
      first: () => Promise<unknown>,
      marker: string,
      second: () => Promise<unknown>
    ) {
      gate.holdId = holdId;
      const one = first();
      await gate.held;
      // Only now: the first write's own hooks have run, so only the second
      // write's can match.
      gate.marker = marker;
      const two = second();
      await Promise.race([
        gate.validated,
        two.then(
          () => undefined,
          () => undefined
        ),
        pause(5_000),
      ]);
      // Long enough for the second write to reach the lock inside its own
      // transaction; were it later, it would only find the first committed.
      await pause(500);
      gate.release();
      return Promise.allSettled([one, two]);
    }

    it("refuses the second half of a loop two concurrent saves close", async () => {
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [text("t2")]);

      const [one, two] = await interleaved(
        a,
        () => setContent(t, a, [placing("n1", b)]),
        "n2-closes-loop",
        () => setContent(t, b, [placing("n2-closes-loop", a)])
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["COMPONENT_CYCLE"]);
      // And nothing of the refused save landed.
      expect(await storedContent(t, a)).toContain(b);
      expect(await storedContent(t, b)).not.toContain(a);
    });

    it("refuses a page placing a component that a concurrent save makes too deep", async () => {
      const t = await boot();
      const deep = await component(t, "deep", [box("d1", [text("d2")])]);

      // Placed two deep, the component's two levels end exactly at the limit
      // of four; made three deep by the first save, the page is five.
      const [one, two] = await interleaved(
        deep,
        () => setContent(t, deep, [box("d1", [box("d3", [text("d2")])])]),
        "p2-placing-deep",
        () =>
          t.nextly.create({
            collection: "pages",
            data: {
              title: "Home",
              slug: "home",
              content: document("page", [
                box("p1", [box("p2-placing-deep", [placing("i1", deep)])]),
              ]),
            },
            overrideAccess: true,
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["depth-exceeded"]);
    });

    it("refuses page content in a slot a concurrent save of its component locks", async () => {
      // The component exposes a slot pages fill. Before the first save it is
      // a box's, which holds anything; the save moves it to a hero whose slot
      // is locked to its two headlines. The page, judged before against the
      // box, fills the slot with three.
      const t = await boot();
      // After the boot, which starts the block registry afresh.
      registerLockedHero();
      const shell = box("shell", []);
      const c = String(
        (
          await t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: "promo",
              slug: "promo",
              content: {
                ...document("component", [shell]),
                slots: {
                  extra: { label: "Extra", nodeId: "shell", slot: "children" },
                },
              },
            },
            overrideAccess: true,
          })
        ).item.id
      );
      const hero = inserted("acme/locked-hero");

      const [one, two] = await interleaved(
        c,
        () =>
          t.nextly.update({
            collection: COMPONENTS_SLUG,
            id: c,
            data: {
              content: {
                ...document("component", [hero]),
                slots: {
                  extra: { label: "Extra", nodeId: hero.id, slot: "content" },
                },
              },
              _overwrite: true,
            },
            overrideAccess: true,
          }),
        "fills-the-locked-slot",
        () =>
          t.nextly.create({
            collection: "pages",
            data: {
              title: "Home",
              slug: "home",
              content: document("page", [
                {
                  ...placing("fills-the-locked-slot", c),
                  slots: {
                    extra: [
                      makeNode("acme/headline", 1, { text: "One" }),
                      makeNode("acme/headline", 1, { text: "Two" }),
                      makeNode("acme/headline", 1, { text: "Three" }),
                    ],
                  },
                },
              ]),
            },
            overrideAccess: true,
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(
        codesOf(two.status === "rejected" ? two.reason : undefined)
      ).toEqual(["locked-slot-altered"]);
    });

    it("refuses a Single placing a component that a concurrent save makes too deep", async () => {
      const t = await boot();
      const deep = await component(t, "deep", [box("d1", [text("d2")])]);
      const singles = t.getService("singleEntryService") as unknown as Singles;

      const [one, two] = await interleaved(
        deep,
        () => setContent(t, deep, [box("d1", [box("d3", [text("d2")])])]),
        "h2-placing-deep",
        async () => {
          const saved = await singles.update(
            HOMEPAGE,
            {
              content: document("page", [
                box("h1", [box("h2-placing-deep", [placing("i1", deep)])]),
              ]),
            },
            { overrideAccess: true }
          );
          if (!saved.success) throw new Error(JSON.stringify(saved));
          return saved;
        }
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
    });

    it("refuses the second half of a loop saved in a transaction its caller opened", async () => {
      // A caller's own transaction keeps the caller's isolation: on MySQL,
      // REPEATABLE READ, whose reads answer from the snapshot its first read
      // took, before the held write committed. Judged on that snapshot, the
      // second half of the loop would pass.
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [text("t2")]);
      const entries = (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): CallerTransactionEntries;
        }
      ).getEntryService();

      const [one, two] = await interleaved(
        a,
        () => setContent(t, a, [placing("n1", b)]),
        "n2-in-caller-transaction",
        () =>
          t.adapter.transaction(async tx => {
            const result = await entries.updateEntryInTransaction(
              tx,
              {
                collectionName: COMPONENTS_SLUG,
                entryId: b,
                overrideAccess: true,
              },
              {
                content: document("component", [
                  placing("n2-in-caller-transaction", a),
                ]),
                _overwrite: true,
              }
            );
            if (!result.success) throw new Error(JSON.stringify(result));
            return result;
          })
      );

      expect(one.status).toBe("fulfilled");
      expect(two.status).toBe("rejected");
      expect(await storedContent(t, b)).not.toContain(a);
    });

    it.skipIf(dialect === "sqlite")(
      "lets a write to an unrelated collection through while the lock is held",
      async () => {
        // SQLite lets one writer in at a time whatever is locked, so there
        // every write waits for the held one.
        const t = await boot();
        const a = await component(t, "a", [text("t1")]);
        gate.holdId = a;
        const held = setContent(t, a, [box("b1", [text("t1")])]);
        await gate.held;

        // CONTROL: a page write does wait at the lock while it is held.
        const pageWrite = t.nextly.create({
          collection: "pages",
          data: {
            title: "Waits",
            slug: "waits",
            content: document("page", [text("w1")]),
          },
          overrideAccess: true,
        });
        const pageFirst = await Promise.race([
          pageWrite.then(() => "page"),
          pause(1_500).then(() => "held"),
        ]);
        expect(pageFirst).toBe("held");

        const note = await Promise.race([
          t.nextly
            .create({
              collection: "notes",
              data: { title: "Unrelated" },
              overrideAccess: true,
            })
            .then(() => "note"),
          pause(5_000).then(() => "held"),
        ]);
        expect(note).toBe("note");

        gate.release();
        await held;
        await pageWrite;
      }
    );
  }
);

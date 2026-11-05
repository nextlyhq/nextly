/**
 * The cleanup's step, which says what each stored form becomes, and the check
 * after every committed write, which sends a component's run back to be walked
 * again. The walk itself, its runs and its writes are proved against a real
 * database in `__tests__/retired-fields-cleanup.integration.test.ts`.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type RetiredByComponent,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { StoredForm } from "./host-rewrite/contract";
import {
  registerRetiredCleanupCheck,
  stripRetiredStep,
} from "./retired-cleanup";

type Row = Record<string, unknown>;

const LIMITS = { maxDepth: 12, maxNodes: 5000, maxBytes: 2_097_152 };
const STORE = { collection: "nx_pb_components", field: "content" };
const RETIRED: RetiredExposures = { properties: ["title"], slots: ["aside"] };

const heading = (id: string): Row => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const placing = (
  id: string,
  componentId: string,
  overrides?: Row,
  slots?: Row
): Row => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...(overrides === undefined ? {} : { overrides }) },
  ...(slots === undefined ? {} : { slots }),
});

const page = (nodes: Row[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A definition exposing `title` and `body`, a slot `aside`, and a variant. */
const heroDefinition = (): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [heading("h")],
  exposed: ["title", "body"].map(id => ({
    id,
    label: id,
    nodeId: "h",
    propPath: "text",
    type: "text",
  })),
  slots: { aside: { label: "Aside", nodeId: "h", slot: "children" } },
  variants: { dark: { name: "Dark", overrides: { title: "T", body: "B" } } },
});

const formOf = (host: Partial<StoredForm["host"]> = {}): StoredForm => ({
  host: {
    kind: "collection",
    slug: "pages",
    id: "p1",
    path: ["content"],
    ...host,
  },
  form: "published",
});

const step = () =>
  stripRetiredStep({
    componentId: "hero",
    retired: RETIRED,
    limits: LIMITS,
    store: STORE,
  });

describe("the strip-retired step", () => {
  it("takes the component's retired values out of each placement of it, nested ones too", async () => {
    const outcome = await step()(
      page([
        placing("i1", "hero", { title: "old", body: "kept" }),
        placing(
          "i2",
          "card",
          { title: "another component's" },
          {
            body: [
              placing(
                "i3",
                "hero",
                { title: "deep" },
                { aside: [heading("gone")] }
              ),
            ],
          }
        ),
      ]),
      formOf()
    );

    expect(outcome.kind).toBe("rewritten");
    const nodes = (outcome as { value: { nodes: Row[] } }).value.nodes;
    expect((nodes[0]!.props as Row).overrides).toEqual({ body: "kept" });
    expect((nodes[1]!.props as Row).overrides).toEqual({
      title: "another component's",
    });
    const deep = (nodes[1]!.slots as { body: Row[] }).body[0]!;
    expect((deep.props as Row).overrides).toBeUndefined();
    expect(deep.slots).toEqual({});
  });

  it("answers unchanged for a document holding nothing retired, and for its own output", async () => {
    const strip = step();
    expect(
      await strip(page([placing("i1", "hero", { body: "live" })]), formOf())
    ).toEqual({ kind: "unchanged" });

    const first = await strip(
      page([placing("i1", "hero", { title: "old" })]),
      formOf()
    );
    expect(first.kind).toBe("rewritten");
    expect(await strip((first as { value: unknown }).value, formOf())).toEqual({
      kind: "unchanged",
    });
  });

  it("keeps a value stored as JSON text as text", async () => {
    const outcome = await step()(
      JSON.stringify(
        page([placing("i1", "hero", { title: "old", body: "kept" })])
      ),
      formOf()
    );

    const value = (outcome as { value: unknown }).value;
    expect(typeof value).toBe("string");
    const nodes = (JSON.parse(value as string) as { nodes: Row[] }).nodes;
    expect((nodes[0]!.props as Row).overrides).toEqual({ body: "kept" });
  });

  it("refuses a value it cannot read, rather than reading it as nothing to do", async () => {
    const outcome = await step()({ not: "a document" }, formOf());
    expect(outcome.kind).toBe("refuse");
  });

  it("refuses a document too large to read to the end", async () => {
    const strip = stripRetiredStep({
      componentId: "hero",
      retired: RETIRED,
      limits: { ...LIMITS, maxNodes: 2 },
      store: STORE,
    });
    // The retired value sits past the cap, where a capped walk stops.
    const outcome = await strip(
      page([
        heading("a"),
        heading("b"),
        placing("i1", "hero", { title: "old" }),
      ]),
      formOf()
    );
    expect(outcome.kind).toBe("refuse");
  });

  it("drops the component's own retired field, slot and variant values from its own definition", async () => {
    const outcome = await step()(
      heroDefinition(),
      formOf({ slug: STORE.collection, id: "hero" })
    );

    const value = (outcome as { value: Row }).value;
    expect((value.exposed as { id: string }[]).map(entry => entry.id)).toEqual([
      "body",
    ]);
    expect(value.slots).toBeUndefined();
    expect(value.variants).toEqual({
      dark: { name: "Dark", overrides: { body: "B" } },
    });
  });

  it("leaves another component's definition exposing the same ids", async () => {
    expect(
      await step()(
        heroDefinition(),
        formOf({ slug: STORE.collection, id: "card" })
      )
    ).toEqual({ kind: "unchanged" });
  });
});

/** The check's handlers, and the runs it sent back. */
function checkHarness(
  retired: Record<string, RetiredExposures>,
  options: { failRead?: boolean } = {}
) {
  const handlers = new Map<string, (context: unknown) => unknown>();
  const walkedAgain: string[] = [];
  const reads: string[][] = [];
  const errors: string[] = [];
  registerRetiredCleanupCheck({
    ctx: {
      hooks: {
        on: (type, collection, handler) =>
          handlers.set(`${type} ${collection}`, handler),
      },
      logger: { error: message => errors.push(message) },
    },
    retired: async ids => {
      reads.push([...ids]);
      if (options.failRead === true) throw new Error("database down");
      const found: RetiredByComponent = new Map(
        ids.flatMap(id =>
          retired[id] === undefined ? [] : [[id, retired[id]] as const]
        )
      );
      return found;
    },
    cleanup: () => ({
      walkAgain: async componentId => {
        walkedAgain.push(componentId);
      },
    }),
    limits: () => LIMITS,
    store: STORE,
  });
  const run = (phase: string, context: Row) =>
    handlers.get(`${phase} *`)!(context);
  return { run, walkedAgain, reads, errors };
}

describe("the check after a committed write", () => {
  it("sends a component's run back when the stored document still holds its retired value", async () => {
    const { run, walkedAgain } = checkHarness({ hero: RETIRED });

    await run("afterUpdate", {
      collection: "pages",
      data: {
        id: "p1",
        content: page([placing("i1", "hero", { title: "raced" })]),
      },
    });

    expect(walkedAgain).toEqual(["hero"]);
  });

  it("finds a document under a named group, and one stored as text", async () => {
    const { run, walkedAgain } = checkHarness({ hero: RETIRED });

    await run("afterCreate", {
      collection: "single:homepage",
      data: {
        hero: { body: page([placing("i1", "hero", { title: "raced" })]) },
      },
    });
    await run("afterUpdate", {
      collection: "pages",
      data: {
        content: JSON.stringify(page([placing("i1", "hero", { title: "x" })])),
      },
    });

    expect(walkedAgain).toEqual(["hero", "hero"]);
  });

  it("sends a component's run back when its own definition carries a retired field back", async () => {
    const { run, walkedAgain } = checkHarness({ hero: RETIRED });

    await run("afterUpdate", {
      collection: STORE.collection,
      data: { id: "hero", content: heroDefinition() },
    });
    // The same definition stored as another component's is not hero's.
    await run("afterUpdate", {
      collection: STORE.collection,
      data: { id: "card", content: heroDefinition() },
    });

    expect(walkedAgain).toEqual(["hero"]);
  });

  it("sends nothing back for a document holding only live values", async () => {
    const { run, walkedAgain } = checkHarness({ hero: RETIRED });

    await run("afterUpdate", {
      collection: "pages",
      data: { content: page([placing("i1", "hero", { body: "live" })]) },
    });

    expect(walkedAgain).toEqual([]);
  });

  it("reads nothing for a write carrying no document, or made inside a caller's transaction", async () => {
    const { run, reads } = checkHarness({ hero: RETIRED });

    await run("afterUpdate", { collection: "pages", data: { title: "Home" } });
    await run("afterUpdate", {
      collection: "pages",
      executor: {},
      data: { content: page([placing("i1", "hero", { title: "old" })]) },
    });

    expect(reads).toEqual([]);
  });

  it("logs, and does not throw, when the retired ids cannot be read", async () => {
    const { run, errors } = checkHarness({}, { failRead: true });

    await expect(
      run("afterUpdate", {
        collection: "pages",
        data: { content: page([placing("i1", "hero", { title: "old" })]) },
      })
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

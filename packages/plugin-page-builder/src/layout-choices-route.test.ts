/**
 * The Layout choices read: as the caller, published regions only, the draft
 * facts the picker words, and the published definitions the canvas draws.
 */
import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";

import {
  parseSelectedLayout,
  readLayoutChoices,
  readPageCollection,
  type LayoutChoicesContext,
  type LayoutChoicesDirectApi,
} from "./layout-choices-route";

const component = (nodes: unknown[]) => ({
  formatVersion: 1,
  kind: "component",
  nodes,
});

interface Store {
  layouts: Record<string, unknown>[];
  /** Published component rows, by id. */
  components: Record<string, unknown>;
  /** Ids whose by-id draft read surfaces a pending working draft. */
  drafts: string[];
  defaultLayout: string | null;
  /** The collection Layouts are read from. */
  layoutsCollection: string;
  /** The field component documents are stored in, when not `content`. */
  componentField?: string;
}

/** The row clamp the real query service applies to every list read. */
const MAX_ROWS = 500;

function fake(store: Store) {
  const calls: Record<string, unknown>[] = [];
  const nextly = {
    find: vi.fn(async (args: Record<string, unknown>) => {
      calls.push(args);
      const limit = Math.min(Number(args.limit ?? MAX_ROWS), MAX_ROWS);
      const asked = (args.where as { id?: { in?: string[] } } | undefined)?.id
        ?.in;
      if (args.collection === store.layoutsCollection) {
        const rows =
          asked === undefined
            ? store.layouts
            : store.layouts.filter(row => asked.includes(String(row.id)));
        return {
          items: rows.slice(0, limit),
          meta: { hasNext: rows.length > limit },
        };
      }
      const field = store.componentField ?? "content";
      return {
        items: (asked ?? [])
          .filter(id => store.components[id] !== undefined)
          .map(id => ({ id, [field]: store.components[id] }))
          .slice(0, limit),
        meta: { hasNext: false },
      };
    }),
    findByID: vi.fn(async (args: Record<string, unknown>) => {
      calls.push(args);
      return store.drafts.includes(String(args.id))
        ? { id: args.id, _isWorkingDraft: true }
        : { id: args.id };
    }),
    findSingle: vi.fn(async () => ({ defaultLayout: store.defaultLayout })),
  } as unknown as LayoutChoicesDirectApi;
  return { nextly, calls };
}

function context(canUpdate = true): LayoutChoicesContext {
  const user = { id: "author" };
  return {
    self: { collections: {}, singles: {} },
    caller: {
      identity: async () => ({ user }),
      can: async (action: string) => action !== "update" || canUpdate,
    },
  } as unknown as LayoutChoicesContext;
}

/** The request the editor makes, with the plugin's own component store. */
const asked = (
  selected: string | null = null,
  store: ComponentStore = DEFAULT_COMPONENT_STORE
) => ({ selected, store });

/** A published Layout with a header drawn from `component`. */
const layoutRow = (id: string, title: string, component = "header") => ({
  id,
  title,
  status: "published",
  areas: [{ area: "header", component }],
});

const store: Store = {
  layouts: [
    {
      id: "main",
      title: "Main",
      status: "published",
      areas: [{ area: "header", component: "header" }],
    },
    {
      id: "draft",
      title: "Draft",
      status: "draft",
      areas: [{ area: "header", component: "other" }],
    },
  ],
  components: {
    header: component([
      {
        id: "i",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "logo" },
      },
    ]),
    logo: component([]),
  },
  drafts: ["main", "header"],
  defaultLayout: "main",
  layoutsCollection: "layouts",
};

describe("readLayoutChoices", () => {
  it("reads as the caller, never as the instance", async () => {
    const { nextly, calls } = fake(store);
    await readLayoutChoices(context(), nextly, asked());
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.overrideAccess).toBe(false);
      expect(call.user).toEqual({ id: "author" });
    }
  });

  it("lists every Layout, with regions only for the published ones", async () => {
    const { nextly } = fake(store);
    const { items } = await readLayoutChoices(context(), nextly, asked());
    expect(items).toEqual([
      {
        id: "main",
        title: "Main",
        published: true,
        draftChangesNotLive: true,
        regions: [{ area: "header", componentId: "header" }],
      },
      {
        id: "draft",
        title: "Draft",
        published: false,
        draftChangesNotLive: false,
        regions: [],
      },
    ]);
  });

  it("answers the default, the caller's right to edit, and the region facts", async () => {
    const { nextly } = fake(store);
    const { meta } = await readLayoutChoices(context(false), nextly, asked());
    expect(meta.defaultLayout).toBe("main");
    expect(meta.canUpdateLayouts).toBe(false);
    // Draft facts are asked only for an author who may update: the service
    // shows a working draft to no one else.
    expect(meta.regionComponents).toEqual({
      header: { draftChangesNotLive: false },
    });
  });

  it("answers the region facts for an author who may update", async () => {
    const { nextly } = fake(store);
    const { meta } = await readLayoutChoices(context(), nextly, asked());
    expect(meta.regionComponents).toEqual({
      header: { draftChangesNotLive: true },
    });
  });

  it("reads the regions' PUBLISHED definitions, nested ones included", async () => {
    const { nextly, calls } = fake(store);
    const { meta } = await readLayoutChoices(context(), nextly, asked());
    expect(Object.keys(meta.regionDefinitions).sort()).toEqual([
      "header",
      "logo",
    ]);
    const componentReads = calls.filter(
      call => call.collection === "components" && "where" in call
    );
    expect(componentReads.length).toBeGreaterThan(0);
    for (const read of componentReads) expect(read.status).toBe("published");
  });

  it("answers for the page's Layout and the default past the list's bound", async () => {
    // 250 Layouts sorted by title; the list holds the first 200. The page's
    // own Layout and the site's default both sort past it.
    const layouts = Array.from({ length: 250 }, (_, i) =>
      layoutRow(`l${String(i).padStart(3, "0")}`, `Layout ${i}`)
    );
    const { nextly } = fake({
      ...store,
      layouts,
      defaultLayout: "l230",
    });
    const { items } = await readLayoutChoices(context(), nextly, asked("l240"));
    const byId = new Map(items.map(item => [item.id, item]));
    expect(byId.get("l240")).toMatchObject({
      published: true,
      regions: [{ area: "header", componentId: "header" }],
    });
    expect(byId.get("l230")?.published).toBe(true);
    // A Layout past the bound that is neither stays out: the list is bounded.
    expect(byId.has("l220")).toBe(false);
  });

  it("resolves every definition when the regions reach more than a read's clamp", async () => {
    // One header holding 600 distinct components: more than one read returns.
    const nested = Array.from({ length: 600 }, (_, i) => `c${i}`);
    const components: Record<string, unknown> = {
      header: component(
        nested.map(id => ({
          id: `n-${id}`,
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: id },
        }))
      ),
    };
    for (const id of nested) components[id] = component([]);
    const { nextly } = fake({ ...store, components });
    const { meta } = await readLayoutChoices(context(), nextly, asked());
    expect(Object.keys(meta.regionDefinitions)).toHaveLength(601);
  });

  it("makes a fixed number of reads, however many Layouts there are", async () => {
    const readsFor = async (count: number) => {
      const layouts = Array.from({ length: count }, (_, i) =>
        layoutRow(`l${i}`, `Layout ${i}`)
      );
      const { nextly, calls } = fake({
        ...store,
        layouts,
        defaultLayout: "l0",
      });
      await readLayoutChoices(context(), nextly, asked("l1"));
      return calls.length;
    };
    const few = await readsFor(3);
    expect(await readsFor(150)).toBe(few);
  });

  it("asks no draft read of an author who may not update", async () => {
    const { nextly, calls } = fake(store);
    await readLayoutChoices(context(false), nextly, asked("main"));
    expect(calls.filter(call => call.draft === true)).toEqual([]);
  });

  it("reads definitions from the component store the plugin was told about", async () => {
    const { nextly, calls } = fake({ ...store, componentField: "body" });
    const { meta } = await readLayoutChoices(
      context(),
      nextly,
      asked(null, { collection: "site-components", field: "body" })
    );
    expect(Object.keys(meta.regionDefinitions).sort()).toEqual([
      "header",
      "logo",
    ]);
    const componentReads = calls.filter(call => "where" in call);
    expect(
      componentReads.some(call => call.collection === "site-components")
    ).toBe(true);
    expect(componentReads.some(call => call.collection === "components")).toBe(
      false
    );
  });
});

describe("parseSelectedLayout", () => {
  it("reads the selected Layout's id, or none", () => {
    expect(parseSelectedLayout("http://x/layouts/choices?selected=abc")).toBe(
      "abc"
    );
    expect(parseSelectedLayout("http://x/layouts/choices")).toBeNull();
  });

  it("refuses a value that is not an id", () => {
    expect(() =>
      parseSelectedLayout(
        `http://x/layouts/choices?selected=${"x".repeat(201)}`
      )
    ).toThrow();
    expect(() =>
      parseSelectedLayout("http://x/layouts/choices?selected=")
    ).toThrow();
  });
});

describe("readPageCollection", () => {
  it("answers the pages collection's resolved slug, renamed or not", () => {
    expect(
      readPageCollection({
        self: { collections: { pages: "site-pages" }, singles: {} },
      } as unknown as Parameters<typeof readPageCollection>[0])
    ).toEqual({ pagesCollection: "site-pages" });
    expect(
      readPageCollection({
        self: { collections: {}, singles: {} },
      } as unknown as Parameters<typeof readPageCollection>[0])
    ).toEqual({ pagesCollection: "pages" });
  });
});

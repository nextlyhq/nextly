/**
 * The Layout choices read: as the caller, published regions only, the draft
 * facts the picker words, and the published definitions the canvas draws.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COMPONENT_STORE, type ComponentStore } from "./library-route";

import {
  parseChoicesQuery,
  readLayoutChoices,
  readPageCollection,
  type LayoutChoicesContext,
  type LayoutChoicesRequest,
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
  /** Component documents in another language, by language, then by id. */
  localized?: Record<string, Record<string, unknown>>;
  /**
   * Component documents an `afterRead` hook derives from a POPULATED
   * relation, by id: what a read at the renderer's depth returns. A read at
   * depth 0 hands the hook bare ids and gets the stored document instead.
   */
  populated?: Record<string, unknown>;
  /**
   * The ids whose working draft the caller may see, as the service decides
   * per row: a draft is overlaid only for a caller who may update or publish
   * that row.
   * Every id when unstated.
   */
  updatable?: string[];
  /**
   * Layout ids a row rule hides from the caller: a read made as the caller
   * does not return them, a read made as the system does.
   */
  filtered?: string[];
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
        const search = (
          args.where as { title?: { contains?: string } } | undefined
        )?.title?.contains;
        const rows = store.layouts
          .filter(
            row =>
              args.overrideAccess === true ||
              !(store.filtered ?? []).includes(String(row.id))
          )
          .filter(row => asked === undefined || asked.includes(String(row.id)))
          .filter(
            row =>
              search === undefined ||
              String(row.title).toLowerCase().includes(search.toLowerCase())
          );
        return {
          items: rows.slice(0, limit),
          meta: { hasNext: rows.length > limit },
        };
      }
      const field = store.componentField ?? "content";
      const inLanguage =
        typeof args.locale === "string"
          ? store.localized?.[args.locale]
          : undefined;
      const documentOf = (id: string): unknown =>
        inLanguage?.[id] ??
        (!("depth" in args) ? store.populated?.[id] : undefined) ??
        store.components[id];
      return {
        items: (asked ?? [])
          .filter(id => documentOf(id) !== undefined)
          .map(id => ({ id, [field]: documentOf(id) }))
          .slice(0, limit),
        meta: { hasNext: false },
      };
    }),
    findByID: vi.fn(async (args: Record<string, unknown>) => {
      calls.push(args);
      const id = String(args.id);
      const mayUpdate = store.updatable?.includes(id) ?? true;
      return store.drafts.includes(id) && mayUpdate
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
  store: ComponentStore = DEFAULT_COMPONENT_STORE,
  extra: Partial<LayoutChoicesRequest> = {}
): LayoutChoicesRequest => ({
  selected,
  store,
  limits: DEFAULT_LIMITS,
  ...extra,
});

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

  it("marks each Layout behind Remove Layout's fence, from one read of the fence", async () => {
    const { nextly } = fake(store);
    const asks: string[][] = [];
    const { items } = await readLayoutChoices(
      context(),
      nextly,
      asked(null, DEFAULT_COMPONENT_STORE, {
        fence: {
          removalStates: async ids => {
            asks.push([...ids]);
            return new Map([["draft", "unpublished" as const]]);
          },
        },
      })
    );
    expect(asks).toHaveLength(1);
    expect(items.find(item => item.id === "draft")?.removal).toBe(
      "unpublished"
    );
    expect(items.find(item => item.id === "main")).not.toHaveProperty(
      "removal"
    );
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
    const { nextly } = fake({ ...store, updatable: [] });
    const { meta } = await readLayoutChoices(context(false), nextly, asked());
    expect(meta.defaultLayout).toBe("main");
    expect(meta.canUpdateLayouts).toBe(false);
    // The service shows a working draft only to a caller who may update or
    // publish the row, so this author is told of none.
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

  it("warns of a Layout's draft when a row rule lets the author update that Layout", async () => {
    // The collection-wide question answers no, as it does for a rule that
    // filters rows; the row itself is one this author may update.
    const { nextly } = fake({ ...store, updatable: ["main", "header"] });
    const { items, meta } = await readLayoutChoices(
      context(false),
      nextly,
      asked("main")
    );
    expect(items.find(item => item.id === "main")?.draftChangesNotLive).toBe(
      true
    );
    expect(meta.regionComponents.header).toEqual({
      draftChangesNotLive: true,
    });
  });

  it("tells an author the rule does not let update nothing of a draft", async () => {
    const { nextly, calls } = fake({ ...store, updatable: [] });
    const answer = await readLayoutChoices(
      context(false),
      nextly,
      asked("main")
    );
    expect(
      answer.items.find(item => item.id === "main")?.draftChangesNotLive
    ).toBe(false);
    expect(answer.meta.regionComponents.header).toEqual({
      draftChangesNotLive: false,
    });
    // Every draft read is made as this author, so the access gate judges it.
    const draftReads = calls.filter(call => call.draft === true);
    for (const read of draftReads) expect(read.overrideAccess).toBe(false);
  });

  it("fails the answer when a draft read fails for any reason but access", async () => {
    const throwing = (error: Error) => {
      const { nextly } = fake(store);
      (nextly as { findByID: unknown }).findByID = async () => {
        throw error;
      };
      return nextly;
    };
    await expect(
      readLayoutChoices(context(), throwing(new Error("hook threw")), asked())
    ).rejects.toThrow("hook threw");
    // A refusal is expected: no draft facts, and the answer stands.
    const refused = await readLayoutChoices(
      context(),
      throwing(NextlyError.notFound()),
      asked()
    );
    expect(refused.meta.regionComponents.header).toEqual({
      draftChangesNotLive: false,
    });
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
  it("reads region content in the page's editing language", async () => {
    const german = component([]);
    const { nextly, calls } = fake({
      ...store,
      localized: { de: { header: german } },
    });
    const { meta } = await readLayoutChoices(
      context(),
      nextly,
      asked(null, DEFAULT_COMPONENT_STORE, { locale: "de" })
    );
    expect(meta.regionDefinitions.header).toEqual(german);
    // The Layouts too: their regions are region content.
    const layoutReads = calls.filter(call => call.collection === "layouts");
    expect(layoutReads.length).toBeGreaterThan(0);
    for (const read of layoutReads) expect(read.locale).toBe("de");
  });

  it("discovers definitions under the limits the published renderer uses", async () => {
    // A header past the default node bound: a filler placed 5,050 times, then
    // a component only a raised bound reaches.
    const instance = (id: string, componentId: string) => ({
      id,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId },
    });
    const components: Record<string, unknown> = {
      header: component([
        ...Array.from({ length: 5050 }, (_, i) => instance(`f${i}`, "filler")),
        instance("late-node", "late"),
      ]),
      filler: component([]),
      late: component([]),
    };
    const read = async (limits: typeof DEFAULT_LIMITS) => {
      const { nextly } = fake({ ...store, components });
      const { meta } = await readLayoutChoices(
        context(),
        nextly,
        asked(null, DEFAULT_COMPONENT_STORE, { limits })
      );
      return Object.keys(meta.regionDefinitions);
    };
    // The control: under the default bound the late component is not reached.
    expect(await read(DEFAULT_LIMITS)).not.toContain("late");
    expect(await read({ ...DEFAULT_LIMITS, maxNodes: 6000 })).toContain("late");
  });

  it("reads definitions at the renderer's relationship depth", async () => {
    // The stored header names nothing; its `afterRead` hook, given a
    // populated relation, derives a document placing the logo, which is what
    // the published renderer reads.
    const derived = component([
      {
        id: "i",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "logo" },
      },
    ]);
    const { nextly, calls } = fake({
      ...store,
      components: { header: component([]), logo: component([]) },
      populated: { header: derived },
    });
    const { meta } = await readLayoutChoices(context(), nextly, asked());
    expect(meta.regionDefinitions.header).toEqual(derived);
    expect(Object.keys(meta.regionDefinitions).sort()).toEqual([
      "header",
      "logo",
    ]);
    // The definition reads: by ids, as the renderer reads them.
    const definitionReads = calls.filter(
      call => call.collection === "components" && "where" in call
    );
    expect(definitionReads.length).toBeGreaterThan(0);
    for (const read of definitionReads) expect("depth" in read).toBe(false);
  });

  it("finds a Layout past the list's bound by searching its title", async () => {
    const layouts = Array.from({ length: 250 }, (_, i) =>
      layoutRow(`l${String(i).padStart(3, "0")}`, `Layout ${i}`)
    );
    const { nextly } = fake({ ...store, layouts, defaultLayout: "l000" });
    const capped = await readLayoutChoices(context(), nextly, asked());
    expect(capped.meta.more).toBe(true);
    expect(capped.items.some(item => item.id === "l230")).toBe(false);
    const found = await readLayoutChoices(
      context(),
      nextly,
      asked(null, DEFAULT_COMPONENT_STORE, { search: "Layout 230" })
    );
    expect(found.items.map(item => item.id)).toContain("l230");
    expect(found.meta.more).toBe(false);
  });

  it("marks only the rows its search matched, not the ones it adds whatever the query", async () => {
    const layouts = Array.from({ length: 250 }, (_, i) =>
      layoutRow(`l${String(i).padStart(3, "0")}`, `Layout ${i}`)
    );
    const { nextly } = fake({ ...store, layouts, defaultLayout: "l000" });
    // The page's own Layout and the default are added to the answer; neither
    // holds the query in its title.
    const found = await readLayoutChoices(
      context(),
      nextly,
      asked("l007", DEFAULT_COMPONENT_STORE, { search: "Layout 230" })
    );
    expect(found.items.map(item => item.id).sort()).toEqual([
      "l000",
      "l007",
      "l230",
    ]);
    expect(found.meta.matched).toEqual(["l230"]);
  });

  it("sends definitions only for the Layouts a page can be drawn inside", async () => {
    // 200 Layouts, each with a header of its own.
    const layouts = Array.from({ length: 200 }, (_, i) =>
      layoutRow(`l${i}`, `Layout ${i}`, `h${i}`)
    );
    const components: Record<string, unknown> = {};
    for (let i = 0; i < 200; i += 1) components[`h${i}`] = component([]);
    const { nextly } = fake({
      ...store,
      layouts,
      components,
      defaultLayout: "l0",
    });
    const { meta } = await readLayoutChoices(context(), nextly, asked("l7"));
    expect(Object.keys(meta.regionDefinitions).sort()).toEqual(["h0", "h7"]);
  });
  it("reads every Layout and component as the caller, never past their access", async () => {
    const { nextly, calls } = fake({ ...store, filtered: ["main"] });
    await readLayoutChoices(context(), nextly, asked("main"));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter(call => call.overrideAccess !== false)).toEqual([]);
  });

  it("answers a hidden Layout and one that does not exist identically", async () => {
    // A row rule hides "secret"; "ghost" exists for nobody. Asking about
    // either must tell the caller nothing that tells them apart.
    const secret = layoutRow("secret", "Secret", "secret-header");
    const probe = async (selected: string) => {
      const { nextly } = fake({
        ...store,
        layouts: [...store.layouts, secret],
        components: { ...store.components, "secret-header": component([]) },
        filtered: ["secret"],
      });
      return readLayoutChoices(context(), nextly, asked(selected));
    };
    const hidden = await probe("secret");
    expect(hidden).toEqual(await probe("ghost"));
    expect(JSON.stringify(hidden)).not.toContain("secret");
  });

  it("does not disclose a default Layout the caller cannot read", async () => {
    const answerWith = async (defaultLayout: string) => {
      const { nextly } = fake({
        ...store,
        layouts: [
          ...store.layouts,
          layoutRow("secret-default", "Secret default"),
        ],
        filtered: ["secret-default"],
        defaultLayout,
      });
      return readLayoutChoices(context(), nextly, asked());
    };
    const hidden = await answerWith("secret-default");
    // A default is set, which the picker says, but not which one.
    expect(hidden.meta.defaultLayout).toBeNull();
    expect(hidden.meta.defaultUnreadable).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain("secret-default");
    // Identical to a default that names a Layout that does not exist.
    expect(hidden).toEqual(await answerWith("ghost-default"));
    // And a readable default is named as before.
    const { nextly } = fake(store);
    const readable = await readLayoutChoices(context(), nextly, asked());
    expect(readable.meta).toMatchObject({
      defaultLayout: "main",
      defaultUnreadable: false,
    });
  });

  it("fails the answer when a definition read fails for any reason but access", async () => {
    const throwing = (error: Error) => {
      const { nextly } = fake(store);
      const find = nextly.find.bind(nextly);
      (nextly as { find: unknown }).find = async (
        args: Record<string, unknown>
      ) => {
        if (args.collection === "components") throw error;
        return find(args as never);
      };
      return nextly;
    };
    await expect(
      readLayoutChoices(
        context(),
        throwing(new Error("database unavailable")),
        asked()
      )
    ).rejects.toThrow("database unavailable");
    // An access refusal is expected: the regions draw as missing instead.
    const refused = await readLayoutChoices(
      context(),
      throwing(NextlyError.forbidden()),
      asked()
    );
    expect(refused.meta.regionDefinitions).toEqual({});
  });

  it("says a region has draft changes when a component it embeds does", async () => {
    // The header itself has none; the logo it places has a pending draft.
    const { nextly } = fake({ ...store, drafts: ["logo"] });
    const { meta } = await readLayoutChoices(context(), nextly, asked());
    expect(meta.regionComponents.header).toEqual({
      draftChangesNotLive: true,
    });
  });

  it("bounds the draft reads for a region's nested components", async () => {
    const nested = Array.from({ length: 40 }, (_, i) => `c${i}`);
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
    const { nextly, calls } = fake({ ...store, components, drafts: [] });
    await readLayoutChoices(context(), nextly, asked());
    const componentDraftReads = calls.filter(
      call => call.collection === "components" && call.draft === true
    );
    expect(componentDraftReads.length).toBeLessThanOrEqual(25);
    expect(componentDraftReads.length).toBeGreaterThan(1);
  });
});

describe("parseChoicesQuery", () => {
  it("reads the selected Layout, the language and the search, or none", () => {
    expect(
      parseChoicesQuery(
        "http://x/layouts/choices?selected=abc&locale=de&q=Land"
      )
    ).toEqual({ selected: "abc", locale: "de", search: "Land" });
    expect(parseChoicesQuery("http://x/layouts/choices")).toEqual({
      selected: null,
      locale: undefined,
      search: undefined,
    });
  });

  it("refuses a value it cannot take", () => {
    expect(() =>
      parseChoicesQuery(`http://x/layouts/choices?selected=${"x".repeat(201)}`)
    ).toThrow();
    expect(() =>
      parseChoicesQuery("http://x/layouts/choices?selected=")
    ).toThrow();
    expect(() =>
      parseChoicesQuery(`http://x/layouts/choices?q=${"x".repeat(201)}`)
    ).toThrow();
  });
});

describe("readPageCollection", () => {
  it("answers the pages and Layouts collections' resolved slugs, renamed or not", () => {
    expect(
      readPageCollection({
        self: {
          collections: { pages: "site-pages", layouts: "site-layouts" },
          singles: {},
        },
      } as unknown as Parameters<typeof readPageCollection>[0])
    ).toEqual({
      pagesCollection: "site-pages",
      layoutsCollection: "site-layouts",
    });
    expect(
      readPageCollection({
        self: { collections: {}, singles: {} },
      } as unknown as Parameters<typeof readPageCollection>[0])
    ).toEqual({ pagesCollection: "pages", layoutsCollection: "layouts" });
  });
});

/**
 * The Layout choices read: as the caller, published regions only, the draft
 * facts the picker words, and the published definitions the canvas draws.
 */
import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  readLayoutChoices,
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
}

function fake(store: Store) {
  const calls: Record<string, unknown>[] = [];
  const nextly = {
    find: vi.fn(async (args: Record<string, unknown>) => {
      calls.push(args);
      if (args.collection === "layouts") {
        return { items: store.layouts, meta: { hasNext: false } };
      }
      const ids = (args.where as { id: { in: string[] } }).id.in;
      return {
        items: ids
          .filter(id => store.components[id] !== undefined)
          .map(id => ({ id, content: store.components[id] })),
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
};

describe("readLayoutChoices", () => {
  it("reads as the caller, never as the instance", async () => {
    const { nextly, calls } = fake(store);
    await readLayoutChoices(context(), nextly);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.overrideAccess).toBe(false);
      expect(call.user).toEqual({ id: "author" });
    }
  });

  it("lists every Layout, with regions only for the published ones", async () => {
    const { nextly } = fake(store);
    const { items } = await readLayoutChoices(context(), nextly);
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
    const { meta } = await readLayoutChoices(context(false), nextly);
    expect(meta.defaultLayout).toBe("main");
    expect(meta.canUpdateLayouts).toBe(false);
    expect(meta.regionComponents).toEqual({
      header: { draftChangesNotLive: true },
    });
  });

  it("reads the regions' PUBLISHED definitions, nested ones included", async () => {
    const { nextly, calls } = fake(store);
    const { meta } = await readLayoutChoices(context(), nextly);
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
});

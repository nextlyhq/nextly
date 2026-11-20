/**
 * The header & footer set writes: a rename changes the title and nothing
 * else, a copy is a draft named "Copy of" its title with a slug of its own,
 * each written as the caller, and each route gated by the set write it makes
 * before its handler runs.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  createLayout,
  duplicateLayout,
  layoutWriteRoutes,
  renameLayout,
  type LayoutWrites,
} from "./layout-writes-route";

/** Writes over rows held in memory, each call recorded. */
function writes(rows: Record<string, Record<string, unknown>>) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const fake: LayoutWrites = {
    find: vi.fn(async args => {
      calls.push({ op: "find", args: [args] });
      const where = args.where as Record<string, Record<string, unknown>>;
      const items = Object.values(rows).filter(row => {
        if (where.id !== undefined) return row.id === where.id.equals;
        if (where.slug !== undefined) {
          return (where.slug.in as unknown[]).includes(row.slug);
        }
        return false;
      });
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: args.limit,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    }),
    readSaved: vi.fn(async (collection, id) => {
      calls.push({ op: "readSaved", args: [collection, id] });
      return rows[id] ?? null;
    }),
    update: vi.fn(async (collection, id, data) => {
      calls.push({ op: "update", args: [collection, id, data] });
      const row = { ...rows[id], ...data };
      rows[id] = row;
      return row;
    }),
    duplicate: vi.fn(async (collection, id, overrides) => {
      calls.push({ op: "duplicate", args: [collection, id, overrides] });
      const copy = { ...rows[id], ...overrides, id: `${id}-copy` };
      rows[copy.id as string] = copy;
      return copy;
    }),
    create: vi.fn(async (collection, data) => {
      calls.push({ op: "create", args: [collection, data] });
      const made = { ...data, id: "made" };
      rows.made = made;
      return made;
    }),
    defaultLayout: vi.fn(async () => (rows.main === undefined ? null : "main")),
    removeCreated: vi.fn(async (ids: readonly string[]) => {
      calls.push({ op: "removeCreated", args: [ids] });
    }),
    starterAreas: vi.fn(async () => {
      calls.push({ op: "starterAreas", args: [] });
      return [
        { area: "header", component: "starter-h-2" },
        { area: "footer", component: "starter-f-2" },
      ];
    }),
  };
  return { fake, calls };
}

const MAIN = {
  id: "main",
  title: "Main",
  slug: "main",
  status: "published",
  _rev: "rev-1",
};

describe("renaming a set", () => {
  it("writes its title and nothing else, from the set as saved and carrying its version", async () => {
    const { fake, calls } = writes({ main: { ...MAIN } });
    const written = await renameLayout("site_layouts", "main", "Site", fake);
    expect(written).toEqual({ id: "main", title: "Site" });
    expect(calls).toEqual([
      { op: "readSaved", args: ["site_layouts", "main"] },
      {
        op: "update",
        args: ["site_layouts", "main", { title: "Site", _rev: "rev-1" }],
      },
    ]);
  });

  it("is not found for a set the caller cannot read, and writes nothing", async () => {
    const { fake, calls } = writes({});
    await expect(
      renameLayout("layouts", "gone", "Site", fake)
    ).rejects.toSatisfy(error => NextlyError.isNotFound(error));
    expect(calls.some(call => call.op === "update")).toBe(false);
  });
});

describe("copying a set", () => {
  it("makes a draft named Copy of its title, with a free slug", async () => {
    const { fake, calls } = writes({
      main: { ...MAIN },
      taken: { id: "taken", title: "x", slug: "copy-of-main" },
    });
    const written = await duplicateLayout("layouts", "main", fake);
    expect(written).toEqual({ id: "main-copy", title: "Copy of Main" });
    const copied = calls.find(call => call.op === "duplicate");
    expect(copied?.args).toEqual([
      "layouts",
      "main",
      { title: "Copy of Main", slug: "copy-of-main-2", status: "draft" },
    ]);
  });

  it("is not found for a set the caller cannot read", async () => {
    const { fake, calls } = writes({});
    await expect(duplicateLayout("layouts", "gone", fake)).rejects.toSatisfy(
      error => NextlyError.isNotFound(error)
    );
    expect(calls.some(call => call.op === "duplicate")).toBe(false);
  });
});

describe("the routes", () => {
  it("leave who may write to core's own write, as the caller, rather than a collection-wide gate", () => {
    for (const route of layoutWriteRoutes()) {
      expect(route.checksAccess).toBe(true);
      expect("requiredPermission" in route).toBe(false);
    }
  });

  it("refuses a title that is empty or too long before anything is written", async () => {
    const route = layoutWriteRoutes().find(
      entry => entry.path === "/layouts/:id/title"
    );
    const send = (title: unknown) =>
      route?.handler(
        new Request("http://x/layouts/main/title", {
          method: "PATCH",
          body: JSON.stringify({ title }),
          headers: { "content-type": "application/json" },
        }),
        { params: { id: "main" }, self: { collections: {} } } as never
      );
    await expect(send("  ")).rejects.toSatisfy(error =>
      NextlyError.isValidation(error)
    );
    await expect(send("x".repeat(201))).rejects.toSatisfy(error =>
      NextlyError.isValidation(error)
    );
  });
});

describe("making a new set", () => {
  const MAIN_WITH_AREAS = {
    ...MAIN,
    areas: [{ area: "header", component: "ridgeline" }],
  };

  it("copies the site default as a draft under the name given, with a slug of its own", async () => {
    const { fake, calls } = writes({ main: { ...MAIN_WITH_AREAS } });
    const made = await createLayout(
      "layouts",
      { title: "Landing", start: "copy-default" },
      fake
    );
    expect(made).toEqual({ id: "main-copy", title: "Landing" });
    expect(calls.find(call => call.op === "duplicate")?.args).toEqual([
      "layouts",
      "main",
      { title: "Landing", slug: "landing", status: "draft" },
    ]);
  });

  it("is refused a copy where the site has no default", async () => {
    const { fake } = writes({});
    await expect(
      createLayout("layouts", { title: "Landing", start: "copy-default" }, fake)
    ).rejects.toThrow("This site has no default header & footer set to copy.");
  });

  it("makes an empty one with no areas", async () => {
    const { fake, calls } = writes({ main: { ...MAIN } });
    await createLayout("layouts", { title: "Landing", start: "empty" }, fake);
    expect(calls.find(call => call.op === "create")?.args).toEqual([
      "layouts",
      { title: "Landing", slug: "landing", areas: [], status: "draft" },
    ]);
    expect(calls.some(call => call.op === "starterAreas")).toBe(false);
  });

  it("makes one with a new starter header and footer of its own", async () => {
    const { fake, calls } = writes({ main: { ...MAIN } });
    await createLayout("layouts", { title: "Landing", start: "starter" }, fake);
    expect(calls.find(call => call.op === "create")?.args).toEqual([
      "layouts",
      {
        title: "Landing",
        slug: "landing",
        areas: [
          { area: "header", component: "starter-h-2" },
          { area: "footer", component: "starter-f-2" },
        ],
        status: "draft",
      },
    ]);
  });

  it("removes the starter components it made when the set is refused", async () => {
    const { fake, calls } = writes({ main: { ...MAIN } });
    vi.mocked(fake.create).mockRejectedValueOnce(
      NextlyError.forbidden({ logContext: {} })
    );
    await expect(
      createLayout("layouts", { title: "Landing", start: "starter" }, fake)
    ).rejects.toThrow();
    expect(calls.find(call => call.op === "removeCreated")?.args).toEqual([
      ["starter-h-2", "starter-f-2"],
    ]);
  });
});

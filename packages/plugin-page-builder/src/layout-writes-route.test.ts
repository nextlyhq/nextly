/**
 * The header & footer set writes: a rename changes the title and nothing
 * else, a copy is a draft named "Copy of" its title with a slug of its own,
 * each written as the caller, and each route gated by the set write it makes
 * before its handler runs.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
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

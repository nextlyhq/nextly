/**
 * The header & footer area routes: the published components marked for an
 * area, and the write that puts one in a set's area. The write is refused
 * before anything is read for a caller who may not update and publish sets,
 * is made from the set as saved carrying its version, publishes, and keeps
 * every other area as it was.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  layoutAreaRoutes,
  putInArea,
  readAreaComponents,
  type LayoutAreaWrites,
} from "./layout-area-route";

const MAIN = {
  id: "main",
  title: "Main",
  status: "published",
  _rev: "rev-1",
  areas: [
    { id: "r1", area: "header", component: "starter-h" },
    { id: "r2", area: "footer", component: "starter-f" },
  ],
};

/** Writes over a set and some published components held in memory. */
function writes(
  options: {
    may?: boolean;
    set?: Record<string, unknown> | null;
    published?: Record<string, string>;
    stale?: number;
  } = {}
) {
  const calls: string[] = [];
  let set = options.set === undefined ? { ...MAIN } : options.set;
  let stale = options.stale ?? 0;
  const fake: LayoutAreaWrites = {
    mayChange: vi.fn(async () => {
      calls.push("mayChange");
      return options.may ?? true;
    }),
    publishedComponent: vi.fn(async id => {
      calls.push(`component ${id}`);
      const title = (options.published ?? { ridgeline: "Ridgeline" })[id];
      return title === undefined ? null : { id, title };
    }),
    readSaved: vi.fn(async id => {
      calls.push(`readSaved ${id}`);
      return set;
    }),
    update: vi.fn(async (id, data) => {
      calls.push(`update ${id}`);
      if (stale > 0) {
        stale -= 1;
        set = { ...set, _rev: "rev-2" };
        throw new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "Someone else saved this.",
          logContext: { reason: "test" },
        });
      }
      set = { ...set, ...data };
      return set;
    }),
  };
  return { fake, calls, stored: () => set };
}

describe("putting a component in a set's area", () => {
  it("refuses a caller who may not update and publish sets before anything is read", async () => {
    const { fake, calls } = writes({ may: false });
    await expect(
      putInArea("main", "header", "ridgeline", fake)
    ).rejects.toSatisfy(error => NextlyError.isForbidden(error));
    expect(calls).toEqual(["mayChange"]);
  });

  it("refuses a component that is not published, or not the caller's to read, and writes nothing", async () => {
    const { fake, calls } = writes({ published: {} });
    await expect(
      putInArea("main", "header", "ridgeline", fake)
    ).rejects.toSatisfy(error => NextlyError.isNotFound(error));
    expect(calls).toEqual(["mayChange", "component ridgeline"]);
  });

  it("is not found for a set the caller cannot read, and writes nothing", async () => {
    const { fake, calls } = writes({ set: null });
    await expect(
      putInArea("main", "header", "ridgeline", fake)
    ).rejects.toSatisfy(error => NextlyError.isNotFound(error));
    expect(calls).not.toContain("update main");
  });

  it("refuses a set holding changes not published yet, which publishing would ship", async () => {
    const { fake, calls } = writes({
      set: { ...MAIN, _isWorkingDraft: true },
    });
    const refused = await putInArea("main", "header", "ridgeline", fake).catch(
      (error: unknown) => error
    );
    expect(NextlyError.isConflict(refused)).toBe(true);
    expect((refused as NextlyError).publicMessage).toBe(
      "The Main header & footer has changes that aren't published yet. Publish or discard them first, then choose its header."
    );
    expect(calls).not.toContain("update main");
  });

  it("refuses a set that is not published", async () => {
    const { fake, calls } = writes({ set: { ...MAIN, status: "draft" } });
    const refused = await putInArea("main", "footer", "ridgeline", fake).catch(
      (error: unknown) => error
    );
    expect(NextlyError.isConflict(refused)).toBe(true);
    expect((refused as NextlyError).publicMessage).toBe(
      "The Main header & footer isn't published. Publish it first, then choose its footer."
    );
    expect(calls).not.toContain("update main");
  });

  it("writes the area from the set as saved, with its version, published, keeping the other area", async () => {
    const { fake } = writes();
    const written = await putInArea("main", "header", "ridgeline", fake);
    expect(written).toEqual({
      set: { id: "main", title: "Main" },
      area: "header",
      component: { id: "ridgeline", title: "Ridgeline" },
    });
    expect(fake.update).toHaveBeenCalledTimes(1);
    expect(fake.update).toHaveBeenCalledWith("main", {
      areas: [
        { id: "r1", area: "header", component: "ridgeline" },
        { id: "r2", area: "footer", component: "starter-f" },
      ],
      status: "published",
      _rev: "rev-1",
    });
  });

  it("reads the set again and makes only its own change after a save in between", async () => {
    const { fake } = writes({ stale: 1 });
    await putInArea("main", "header", "ridgeline", fake);
    expect(fake.readSaved).toHaveBeenCalledTimes(2);
    expect(fake.update).toHaveBeenLastCalledWith(
      "main",
      expect.objectContaining({ _rev: "rev-2" })
    );
  });
});

describe("the components marked for an area", () => {
  const ctx = (rights: { update?: boolean; publish?: boolean } = {}) => ({
    self: { collections: {} },
    caller: {
      can: vi.fn(async (action: string) =>
        action === "update"
          ? (rights.update ?? true)
          : action === "publish"
            ? (rights.publish ?? true)
            : false
      ),
      identity: vi.fn(async () => ({ user: { id: "ada" } })),
    },
  });

  function nextly(rows: Record<string, unknown>[], hasNext = false) {
    return {
      find: vi.fn(async (args: Record<string, unknown>) => {
        if ((args.where as { id?: unknown } | undefined)?.id !== undefined) {
          // The pictures' definitions read: none stored here.
          return { items: [] };
        }
        return { items: rows, meta: { hasNext } };
      }),
    };
  }

  it("lists the published components marked for the area, as the caller, by title", async () => {
    const api = nextly([
      { id: "a", title: "Ridgeline" },
      { id: "b", title: "" },
    ]);
    const answer = await readAreaComponents(ctx() as never, api as never, {
      area: "header",
      locale: undefined,
      pictures: false,
      store: { field: "content" },
      limits: {} as never,
    });
    expect(answer.items).toEqual([
      { id: "a", title: "Ridgeline" },
      { id: "b", title: "Untitled" },
    ]);
    expect(answer.meta).toEqual({
      area: "header",
      more: false,
      mayChoose: true,
      definitions: {},
    });
    expect(api.find).toHaveBeenCalledTimes(1);
    expect(api.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "components",
        where: { area: { equals: "header" } },
        status: "published",
        sort: "title",
        overrideAccess: false,
        user: { id: "ada" },
      })
    );
  });

  it("says the caller may not choose without both update and publish on sets", async () => {
    for (const rights of [{ update: false }, { publish: false }]) {
      const answer = await readAreaComponents(
        ctx(rights) as never,
        nextly([]) as never,
        {
          area: "footer",
          locale: undefined,
          pictures: false,
          store: { field: "content" },
          limits: {} as never,
        }
      );
      expect(answer.meta.mayChoose).toBe(false);
    }
  });

  it("says when more are marked for the area than the list holds", async () => {
    const answer = await readAreaComponents(
      ctx() as never,
      nextly([{ id: "a", title: "A" }], true) as never,
      {
        area: "header",
        locale: undefined,
        pictures: false,
        store: { field: "content" },
        limits: {} as never,
      }
    );
    expect(answer.meta.more).toBe(true);
  });
});

describe("the routes", () => {
  it("leave the write to core's own judgement as the caller, and gate the read on reading components", () => {
    const [read, write] = layoutAreaRoutes();
    expect(read?.method).toBe("GET");
    expect(read?.path).toBe("/layouts/area-components");
    expect(
      (
        read as { requiredPermission?: (scope: unknown) => string }
      ).requiredPermission?.({
        collection: (slug: string, action: string) => `${action}-${slug}`,
      })
    ).toBe("read-components");
    expect(write?.method).toBe("PATCH");
    expect(write?.path).toBe("/layouts/:id/areas/:area");
    expect((write as { checksAccess?: boolean }).checksAccess).toBe(true);
    expect("requiredPermission" in (write ?? {})).toBe(false);
  });

  it("refuses an area that is not one, and a missing component, before anything is read", async () => {
    const write = layoutAreaRoutes()[1];
    const can = vi.fn(async () => true);
    const send = (area: string, body: unknown) =>
      write?.handler(
        new Request(`http://x/layouts/main/areas/${area}`, {
          method: "PATCH",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
        {
          params: { id: "main", area },
          self: { collections: {} },
          caller: { can },
        } as never
      );
    await expect(send("sidebar", { component: "a" })).rejects.toSatisfy(error =>
      NextlyError.isValidation(error)
    );
    await expect(send("header", { component: "" })).rejects.toSatisfy(error =>
      NextlyError.isValidation(error)
    );
    expect(can).not.toHaveBeenCalled();
  });

  it("refuses an area that is not one on the read", async () => {
    const read = layoutAreaRoutes()[0];
    await expect(
      read?.handler(
        new Request("http://x/layouts/area-components?area=sidebar"),
        { self: { collections: {} } } as never
      )
    ).rejects.toSatisfy(error => NextlyError.isValidation(error));
  });
});

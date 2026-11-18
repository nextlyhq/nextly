/**
 * "Create a header" for the default's empty area: refused before anything is
 * read for a caller who may not change sets, refused before anything is
 * created for a default that has no such set, holds unpublished changes or
 * already shows that area, and a created component the default then refuses
 * is removed again.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  createInDefaultArea,
  starterComponentData,
  type CreateInAreaWrites,
} from "./create-in-area-route";

const MAIN = {
  id: "main",
  title: "Main",
  status: "published",
  _rev: "rev-1",
  areas: [{ id: "r2", area: "footer", component: "starter-f" }],
};

/** Writes over one default set held in memory, recording each call. */
function writes(
  options: {
    may?: boolean;
    defaultSet?: string | null;
    set?: Record<string, unknown> | null;
    refuseUpdate?: boolean;
    refuseRemove?: boolean;
    /** What lands in the set's header while the create runs, if anything. */
    filledMeanwhile?: string;
  } = {}
) {
  const calls: string[] = [];
  let set = options.set === undefined ? { ...MAIN } : options.set;
  const warn = vi.fn();
  const fake: CreateInAreaWrites = {
    mayChange: async () => {
      calls.push("mayChange");
      return options.may ?? true;
    },
    defaultSet: async () => {
      calls.push("defaultSet");
      return options.defaultSet === undefined ? "main" : options.defaultSet;
    },
    readSaved: async id => {
      calls.push(`readSaved ${id}`);
      return set;
    },
    createStarter: async area => {
      calls.push(`create ${area}`);
      if (options.filledMeanwhile !== undefined && set !== null) {
        const areas = (set.areas ?? []) as Record<string, unknown>[];
        set = {
          ...set,
          _rev: "rev-2",
          areas: [
            ...areas,
            { id: "r9", area: "header", component: options.filledMeanwhile },
          ],
        };
      }
      return { id: "new-h", title: "Header" };
    },
    publishedComponent: async id => {
      calls.push(`component ${id}`);
      return id === "new-h" || id === "theirs" ? { id, title: "Header" } : null;
    },
    update: async (id, data) => {
      calls.push(`update ${id}`);
      if (options.refuseUpdate === true) {
        throw NextlyError.forbidden({ logContext: { reason: "test" } });
      }
      set = { ...set, ...data };
      return set;
    },
    removeCreated: async id => {
      calls.push(`remove ${id}`);
      if (options.refuseRemove === true) throw new Error("still placed");
    },
    warn,
  };
  return { fake, calls, warn, stored: () => set };
}

describe("creating a header for the default's empty area", () => {
  it("creates the header, then puts it in the default, keeping the footer", async () => {
    const { fake, calls, stored } = writes();
    const written = await createInDefaultArea("header", fake);
    expect(written).toEqual({
      set: { id: "main", title: "Main" },
      area: "header",
      component: { id: "new-h", title: "Header" },
    });
    expect(calls.indexOf("create header")).toBeGreaterThan(
      calls.indexOf("readSaved main")
    );
    expect(calls.at(-1)).toBe("update main");
    const areas = (stored()?.areas ?? []) as {
      area: string;
      component: string;
    }[];
    expect(areas.map(row => [row.area, row.component])).toEqual([
      ["footer", "starter-f"],
      ["header", "new-h"],
    ]);
    expect(stored()?.status).toBe("published");
  });

  it("refuses a caller who may not update and publish sets before anything is read", async () => {
    const { fake, calls } = writes({ may: false });
    await expect(createInDefaultArea("header", fake)).rejects.toSatisfy(error =>
      NextlyError.isForbidden(error)
    );
    expect(calls).toEqual(["mayChange"]);
  });

  it("refuses a site with no default set, creating nothing", async () => {
    const { fake, calls } = writes({ defaultSet: null });
    await expect(createInDefaultArea("header", fake)).rejects.toSatisfy(error =>
      NextlyError.isCode(error, "CONFLICT")
    );
    expect(calls).toEqual(["mayChange", "defaultSet"]);
  });

  it("refuses a default the caller cannot read, creating nothing", async () => {
    const { fake, calls } = writes({ set: null });
    await expect(createInDefaultArea("header", fake)).rejects.toSatisfy(error =>
      NextlyError.isNotFound(error)
    );
    expect(calls).not.toContain("create header");
  });

  it("refuses a default holding unpublished changes, creating nothing", async () => {
    const { fake, calls } = writes({
      set: { ...MAIN, _isWorkingDraft: true },
    });
    await expect(createInDefaultArea("header", fake)).rejects.toThrow(
      /changes that aren.t published yet/
    );
    expect(calls).not.toContain("create header");
  });

  it("refuses an area that already shows a component, creating nothing", async () => {
    const { fake, calls } = writes({
      set: {
        ...MAIN,
        areas: [...MAIN.areas, { id: "r1", area: "header", component: "h" }],
      },
    });
    await expect(createInDefaultArea("header", fake)).rejects.toThrow(
      "The Main header & footer already has a header. Reload to see it."
    );
    expect(calls).not.toContain("create header");
  });

  it("refuses a caller who cannot read the set's areas, creating nothing", async () => {
    const { fake, calls } = writes({
      set: { id: "main", title: "Main", status: "published", _rev: "rev-1" },
    });
    await expect(createInDefaultArea("header", fake)).rejects.toSatisfy(error =>
      NextlyError.isForbidden(error)
    );
    expect(calls).not.toContain("create header");
  });

  it("refuses, keeping their choice, when someone fills the area while the header is created", async () => {
    const { fake, calls, stored } = writes({ filledMeanwhile: "theirs" });
    await expect(createInDefaultArea("header", fake)).rejects.toThrow(
      "The Main header & footer already has a header. Reload to see it."
    );
    expect(calls).not.toContain("update main");
    expect(calls.at(-1)).toBe("remove new-h");
    const areas = (stored()?.areas ?? []) as {
      area: string;
      component: string;
    }[];
    expect(areas.find(row => row.area === "header")?.component).toBe("theirs");
  });

  it("goes on when what fills the area meanwhile is the header it created", async () => {
    // A site's first published header fills its seeded default by itself.
    const { fake, calls } = writes({ filledMeanwhile: "new-h" });
    const written = await createInDefaultArea("header", fake);
    expect(written.component.id).toBe("new-h");
    expect(calls).not.toContain("remove new-h");
  });

  it("writes the starter document under the component store's own field", () => {
    const data = starterComponentData("header", {
      title: "Header",
      slug: "header",
      field: "body",
      pagesSlug: "pages",
    });
    expect(Object.keys(data).sort()).toEqual(
      ["area", "body", "slug", "status", "title"].sort()
    );
    expect(data).toMatchObject({ area: "header", status: "published" });
    expect((data.body as { kind?: string }).kind).toBe("component");
  });

  it("removes the header it created when the default refuses it", async () => {
    const { fake, calls } = writes({ refuseUpdate: true });
    await expect(createInDefaultArea("header", fake)).rejects.toSatisfy(error =>
      NextlyError.isForbidden(error)
    );
    expect(calls.at(-1)).toBe("remove new-h");
  });

  it("still reports the refusal when the removal fails, and says so in the log", async () => {
    const { fake, warn } = writes({ refuseUpdate: true, refuseRemove: true });
    await expect(createInDefaultArea("header", fake)).rejects.toSatisfy(error =>
      NextlyError.isForbidden(error)
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be removed"),
      expect.objectContaining({ component: "new-h" })
    );
  });
});

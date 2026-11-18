/**
 * The fill's own order, beyond what the integration suite drives: what it
 * does when the set write fails, when it is refused as stale, and when the
 * default moves while it holds the claim.
 *
 * A fill that kept its mark after a failed write would leave the area
 * unfillable for good; one that wrote the set from a stale read would drop
 * another fill's row; one that wrote after the default moved would change a
 * set the author no longer draws pages in.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { FillMark, FillMarks, FillMarkStore } from "./fill-mark";
import { fillDefaultOnFirstPublish, type FirstFillDeps } from "./first-fill";
import { starterFingerprint } from "./starter-record";

const STARTER_HEADER = { nodes: [{ id: "n1", type: "core/heading" }] };

/** The marks, in memory, with the same claim and take rules as the table's. */
function memoryMarks(): FillMarkStore & { marks: Record<string, FillMark> } {
  const marks: Record<string, FillMark> = {};
  const holds = (area: string, component: string, tell: string | null) =>
    marks[area]?.component === component && marks[area]?.tell === tell;
  return {
    marks,
    read: async () => ({ ...marks }) as FillMarks,
    claim: async (area, component) => {
      if (marks[area] !== undefined) return false;
      marks[area] = { component, tell: null };
      return true;
    },
    release: async (area, component) => {
      if (holds(area, component, null)) delete marks[area];
    },
    announce: async (area, component, user) => {
      if (holds(area, component, null)) marks[area] = { component, tell: user };
    },
    take: async user => {
      const taken: { area: "header" | "footer"; component: string }[] = [];
      for (const area of ["header", "footer"] as const) {
        const mark = marks[area];
        if (mark === undefined || mark.tell !== user) continue;
        marks[area] = { component: mark.component, tell: null };
        taken.push({ area, component: mark.component });
      }
      return taken;
    },
  };
}

interface Stored {
  settings: { defaultLayout: string; seededLayout: string };
  seed: { areas: { area: string; component: string }[]; _rev: string };
}

function depsOver(
  stored: Stored,
  update: (args: { data: Record<string, unknown> }) => Promise<unknown>
): FirstFillDeps & { marks: ReturnType<typeof memoryMarks> } {
  const nextly = {
    findSingle: vi.fn(async () => ({ ...stored.settings })),
    findByID: vi.fn(async () => ({
      id: "main",
      status: "published",
      ...stored.seed,
    })),
    find: vi.fn(async () => ({
      items: [{ id: "starter-h", content: STARTER_HEADER }],
    })),
    update: vi.fn(update),
  };
  return {
    nextly: nextly as never,
    slugs: { layouts: "layouts", settings: "page-builder-settings" },
    components: "components",
    componentField: "content",
    marks: memoryMarks(),
    starter: {
      read: async () => ({
        set: "main",
        header: {
          id: "starter-h",
          fingerprint: starterFingerprint(STARTER_HEADER),
        },
        footer: { id: "starter-f", fingerprint: "x" },
      }),
    },
  };
}

function freshSite(): Stored {
  return {
    settings: { defaultLayout: "main", seededLayout: "main" },
    seed: {
      areas: [
        { area: "header", component: "starter-h" },
        { area: "footer", component: "starter-f" },
      ],
      _rev: "r1",
    },
  };
}

const NEW_HEADER = { id: "mine", area: "header", by: "u1" } as const;

describe("the fill of the default by a first published header", () => {
  it("writes the seed from the version it read, keeping the other area's row, published", async () => {
    const stored = freshSite();
    const deps = depsOver(stored, async () => ({}));
    expect(await fillDefaultOnFirstPublish(deps, NEW_HEADER)).toBe(true);
    expect(deps.nextly.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "layouts",
        id: "main",
        data: {
          areas: [
            { area: "header", component: "mine" },
            { area: "footer", component: "starter-f" },
          ],
          status: "published",
          _rev: "r1",
        },
      })
    );
    expect(deps.marks.marks.header).toEqual({ component: "mine", tell: "u1" });
  });

  it("removes its mark and rethrows when the set write fails, so a later publish can still fill the area", async () => {
    const deps = depsOver(freshSite(), async () => {
      throw new Error("the set refused");
    });
    await expect(fillDefaultOnFirstPublish(deps, NEW_HEADER)).rejects.toThrow(
      "the set refused"
    );
    expect(deps.marks.marks.header).toBeUndefined();
  });

  it("tells nobody while the set is being written, and still lets go of a claim whose write fails", async () => {
    let asked: readonly unknown[] = ["not asked"];
    const deps = depsOver(freshSite(), async () => {
      // The publisher's other tab asks while the set is being written.
      asked = await deps.marks.take("u1");
      throw new Error("the set refused");
    });
    await expect(fillDefaultOnFirstPublish(deps, NEW_HEADER)).rejects.toThrow(
      "the set refused"
    );
    expect(asked).toEqual([]);
    expect(deps.marks.marks.header).toBeUndefined();
  });

  it("reads the seed again and writes on what is stored then, when its write is refused as stale", async () => {
    const stored = freshSite();
    let writes = 0;
    const deps = depsOver(stored, async () => {
      writes += 1;
      if (writes === 1) {
        // A footer's fill landed in between.
        stored.seed = {
          areas: [
            { area: "header", component: "starter-h" },
            { area: "footer", component: "their-footer" },
          ],
          _rev: "r2",
        };
        throw new NextlyError({
          code: "STALE_VERSION",
          publicMessage: "stale",
        });
      }
      return {};
    });
    expect(await fillDefaultOnFirstPublish(deps, NEW_HEADER)).toBe(true);
    expect(deps.nextly.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          areas: [
            { area: "header", component: "mine" },
            { area: "footer", component: "their-footer" },
          ],
          _rev: "r2",
        }),
      })
    );
  });

  it("lets go of its claim and writes nothing when the default moved after it claimed", async () => {
    const stored = freshSite();
    const deps = depsOver(stored, async () => ({}));
    const claim = deps.marks.claim.bind(deps.marks);
    deps.marks.claim = async (area, component) => {
      const landed = await claim(area, component);
      // A make-default lands right after the claim.
      stored.settings = { defaultLayout: "own", seededLayout: "main" };
      return landed;
    };
    expect(await fillDefaultOnFirstPublish(deps, NEW_HEADER)).toBe(false);
    expect(deps.nextly.update).not.toHaveBeenCalled();
    expect(deps.marks.marks.header).toBeUndefined();
  });

  it("leaves a seed holding an unpublished change alone: the author is choosing", async () => {
    const stored = freshSite();
    const deps = depsOver(stored, async () => ({}));
    deps.nextly.findByID = vi.fn(async () => ({
      id: "main",
      status: "published",
      _isWorkingDraft: true,
      ...stored.seed,
    })) as never;
    expect(await fillDefaultOnFirstPublish(deps, NEW_HEADER)).toBe(false);
    expect(deps.nextly.update).not.toHaveBeenCalled();
    expect(deps.marks.marks.header).toBeUndefined();
  });

  it("never fills with the starter itself", async () => {
    const deps = depsOver(freshSite(), async () => ({}));
    expect(
      await fillDefaultOnFirstPublish(deps, {
        id: "starter-f",
        area: "footer",
        by: "u1",
      })
    ).toBe(false);
    expect(deps.nextly.update).not.toHaveBeenCalled();
  });
});

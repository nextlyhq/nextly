import { describe, expect, it } from "vitest";

import {
  settleSpacingModeOnce,
  siteVerdict,
  spacingModeFor,
  type SpacingModeAtStartDeps,
} from "./spacing-mode-at-start";

const SLUGS = {
  pages: "pages",
  components: "components",
  layouts: "layouts",
  settings: "page-builder-settings",
} as const;

interface FindArgs {
  collection: string;
  where?: unknown;
}

/**
 * A Direct API double holding rows per collection and the recorded seed, and
 * keeping every `find` it was asked, so a case can say what was read.
 */
function site(rows: Record<string, string[]>, seededLayout: string | null) {
  const asked: FindArgs[] = [];
  const nextly = {
    find: (args: FindArgs) => {
      asked.push(args);
      const except = (
        args.where as { id?: { not_equals?: string } } | undefined
      )?.id?.not_equals;
      const items = (rows[args.collection] ?? [])
        .filter(id => id !== except)
        .map(id => ({ id }));
      return Promise.resolve({ items: items.slice(0, 1) });
    },
    findSingle: () => Promise.resolve({ seededLayout, defaultLayout: null }),
  } as unknown as SpacingModeAtStartDeps["nextly"];
  return { nextly, asked };
}

describe("spacingModeFor", () => {
  it("keeps an existing site on classic and starts a fresh one on gaps", () => {
    expect(spacingModeFor("existing")).toBe("classic");
    expect(spacingModeFor("fresh")).toBe("gaps");
  });
});

describe("siteVerdict", () => {
  it("leaves the recorded seed out, and a site holding only it is fresh", async () => {
    const { nextly, asked } = site({ layouts: ["seed"] }, "seed");
    expect(await siteVerdict({ nextly, slugs: SLUGS })).toBe("fresh");
    expect(asked.at(-1)?.where).toEqual({ id: { not_equals: "seed" } });
  });

  it("calls a site existing on a page without reading Layouts", async () => {
    const { nextly, asked } = site({ pages: ["p"], layouts: ["seed"] }, null);
    expect(await siteVerdict({ nextly, slugs: SLUGS })).toBe("existing");
    expect(asked.map(a => a.collection)).toEqual(["pages"]);
  });

  it("calls a site existing on a component", async () => {
    const { nextly } = site({ components: ["c"] }, null);
    expect(await siteVerdict({ nextly, slugs: SLUGS })).toBe("existing");
  });

  it("is undecided when a Layout is the only content and no seed is recorded", async () => {
    const { nextly } = site({ layouts: ["maybe-a-seed"] }, null);
    expect(await siteVerdict({ nextly, slugs: SLUGS })).toBe("undecided");
  });

  it("calls a site existing on a Layout beside the recorded seed", async () => {
    const { nextly } = site({ layouts: ["seed", "mine"] }, "seed");
    expect(await siteVerdict({ nextly, slugs: SLUGS })).toBe("existing");
  });
});

describe("settleSpacingModeOnce", () => {
  it("reads nothing more once a model is recorded", async () => {
    const { nextly, asked } = site({ pages: ["p"] }, null);
    let adopted = false;
    const outcome = await settleSpacingModeOnce({
      nextly,
      slugs: SLUGS,
      store: {
        read: () => Promise.resolve("gaps"),
        adoptIfUnset: () => {
          adopted = true;
          return Promise.resolve(true);
        },
      },
    });
    expect(outcome).toBe("kept");
    expect(asked).toEqual([]);
    expect(adopted).toBe(false);
  });

  it("writes nothing when it cannot decide", async () => {
    const { nextly } = site({ layouts: ["maybe-a-seed"] }, null);
    const writes: string[] = [];
    const outcome = await settleSpacingModeOnce({
      nextly,
      slugs: SLUGS,
      store: {
        read: () => Promise.resolve(null),
        adoptIfUnset: mode => {
          writes.push(mode);
          return Promise.resolve(true);
        },
      },
    });
    expect(outcome).toBe("deferred");
    expect(writes).toEqual([]);
  });
});

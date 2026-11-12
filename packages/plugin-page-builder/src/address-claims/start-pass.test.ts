/**
 * The start-up passes and their mark: skipped only when the mark the last
 * complete run left matches every input now, run otherwise, and the mark
 * written only once every pass settled everything.
 */
import { describe, expect, it, vi } from "vitest";

import {
  runAddressStartup,
  startMark,
  type AddressStartupDeps,
  type StartInputs,
} from "./start-pass";

const INPUTS: StartInputs = {
  plugin: "1.0.0",
  slugs: ["pages", "templates", "nx_pb_address_claims"],
  locales: ["en"],
  pagePath: null,
  declared: [["posts", "/blog"]],
  stored: [],
  collections: [
    {
      slug: "posts",
      claims: {
        declared: ["blog"],
        template: { published: true, address: null },
        templatePaginates: false,
        servable: true,
        lifecycle: true,
        locales: ["en"],
      },
      rows: { total: 3, newest: "2026-01-01T00:00:00.000Z" },
    },
  ],
  pages: { total: 5, newest: "2026-01-02T00:00:00.000Z" },
  templates: { total: 1, newest: "2026-01-03T00:00:00.000Z" },
  claims: 12,
};

/**
 * The passes over `inputs`, with the mark store holding `stored` (or failing
 * to read, for an error), recording each step in `ran`.
 */
function deps(
  stored: string | null | Error,
  over: Partial<AddressStartupDeps> & {
    readonly clear?: () => Promise<void>;
  } = {}
): AddressStartupDeps & {
  readonly write: ReturnType<typeof vi.fn>;
  readonly ran: string[];
} {
  const ran: string[] = [];
  const write = vi.fn(async () => {
    ran.push("write");
  });
  return {
    inputs: async () => INPUTS,
    mark: {
      read: async () => {
        if (stored instanceof Error) throw stored;
        return stored;
      },
      clear:
        over.clear ??
        (async () => {
          ran.push("clear");
        }),
      write,
    },
    pages: async () => {
      ran.push("pages");
      return true;
    },
    sweep: async () => {
      ran.push("sweep");
      return true;
    },
    entries: async () => {
      ran.push("entries");
      return true;
    },
    skipped: () => ran.push("skipped"),
    current: () => true,
    warn: () => undefined,
    ...over,
    write,
    ran,
  };
}

describe("runAddressStartup", () => {
  it("skips every pass when the mark matches what the claims follow from now", async () => {
    const run = deps(startMark(INPUTS));
    await runAddressStartup(run);
    expect(run.ran).toEqual(["skipped"]);
  });

  it("runs every pass on a site with no mark yet, then records one", async () => {
    const run = deps(null);
    await runAddressStartup(run);
    expect(run.ran).toEqual(["pages", "sweep", "entries", "write"]);
    expect(run.write).toHaveBeenCalledWith(startMark(INPUTS));
  });

  it("runs every pass when anything changed, and records the mark of the inputs as they are after", async () => {
    let reads = 0;
    const after = { ...INPUTS, claims: 14 };
    const run = deps("stale", {
      inputs: async () => (reads++ === 0 ? INPUTS : after),
    });
    await runAddressStartup(run);
    // The old mark goes before any pass can change a claim.
    expect(run.ran).toEqual(["clear", "pages", "sweep", "entries", "write"]);
    expect(run.write).toHaveBeenCalledWith(startMark(after));
  });

  it("removes a mark it cannot read before running the passes", async () => {
    const run = deps(new Error("down"));
    await runAddressStartup(run);
    expect(run.ran).toEqual(["clear", "pages", "sweep", "entries", "write"]);
  });

  it("runs no pass when the old mark cannot be removed", async () => {
    const run = deps("stale", {
      clear: async () => {
        throw new Error("down");
      },
    });
    await runAddressStartup(run);
    expect(run.ran).toEqual([]);
  });

  it("leaves the mark as it was when the pages' pass did not settle every page, and does not run the entries'", async () => {
    const run = deps("stale", { pages: async () => false });
    await runAddressStartup(run);
    // The old mark is gone, so the next start runs the passes again.
    expect(run.ran).toEqual(["clear", "sweep"]);
    expect(run.write).not.toHaveBeenCalled();
  });

  it("leaves the mark as it was when the sweep or the entries' pass did not settle", async () => {
    for (const failing of ["sweep", "entries"] as const) {
      const run = deps("stale", { [failing]: async () => false });
      await runAddressStartup(run);
      expect(run.write).not.toHaveBeenCalled();
    }
  });

  it("runs the passes and records nothing when the inputs cannot be read", async () => {
    const run = deps(startMark(INPUTS), {
      inputs: async () => {
        throw new Error("down");
      },
    });
    await runAddressStartup(run);
    expect(run.ran).toEqual(["clear", "pages", "sweep", "entries"]);
    expect(run.write).not.toHaveBeenCalled();
  });

  it("records nothing for a start a reload has superseded", async () => {
    const run = deps("stale", { current: () => false });
    await runAddressStartup(run);
    expect(run.write).not.toHaveBeenCalled();
  });
});

describe("startMark", () => {
  it("changes with every input the claims follow from", () => {
    const base = startMark(INPUTS);
    const changed: StartInputs[] = [
      { ...INPUTS, plugin: "1.0.1" },
      { ...INPUTS, slugs: ["site_pages", "templates", "nx_pb_address_claims"] },
      { ...INPUTS, locales: ["en", "fr"] },
      { ...INPUTS, pagePath: "/p/{slug}" },
      { ...INPUTS, declared: [["posts", "/news"]] },
      { ...INPUTS, stored: [["articles", "/articles"]] },
      ...(
        [
          { declared: null },
          { template: { published: false, address: null } },
          { template: { published: true, address: ["posts"] } },
          { templatePaginates: true },
          { servable: false },
          { lifecycle: false },
          { locales: ["en", "fr"] },
        ] as const
      ).map(change => ({
        ...INPUTS,
        collections: [
          {
            ...INPUTS.collections[0]!,
            claims: { ...INPUTS.collections[0]!.claims, ...change },
          },
        ],
      })),
      {
        ...INPUTS,
        collections: [
          { ...INPUTS.collections[0]!, rows: { total: 3, newest: "later" } },
        ],
      },
      { ...INPUTS, pages: { total: 6, newest: INPUTS.pages.newest } },
      { ...INPUTS, pages: { total: 5, newest: "later" } },
      { ...INPUTS, templates: { total: 1, newest: "later" } },
      { ...INPUTS, claims: 11 },
    ];
    for (const inputs of changed) expect(startMark(inputs)).not.toBe(base);
    expect(startMark({ ...INPUTS })).toBe(base);
  });
});

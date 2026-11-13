/**
 * A place contribution's startup reads: the ids a path may name at its place,
 * how a page fills them in, and the boot check that refuses a read the admin
 * could not start, naming the plugin, the contribution and the path.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import type { AdminContribution } from "../admin-contributions";
import { contributedAdminContributions } from "../admin-place-contributions";
import type { PluginDefinition } from "../plugin-context";
import {
  fillPlaceStartupPath,
  namedPlaceIds,
  PLACE_STARTUP_IDS,
  type UnnamedPlaceStartupIds,
} from "../place-startup-reads";

/** The page builder's Design section's read, as it would declare it. */
const DESIGN_READ =
  "/templates/entry-designs?collection={collection}&entry={entryId}";

/** A plugin declaring one side panel section with these startup reads. */
function sectionWith(
  startupReads: unknown,
  place = "collection.edit"
): PluginDefinition {
  return {
    name: "@acme/designs",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      admin: {
        contributions: [
          {
            id: "acme-designs.design",
            kind: place === "collection.edit" ? "sidebarSection" : "block",
            place,
            ...(place === "collection.edit" ? { label: "Design" } : {}),
            component: "@acme/designs/admin#Design",
            startupReads,
          } as unknown as AdminContribution,
        ],
      },
    },
  };
}

/** What the operator reads of a refused declaration: its log message. */
function refusal(plugin: PluginDefinition): string {
  try {
    contributedAdminContributions([plugin]);
  } catch (error) {
    const { logMessage } = error as { logMessage?: string };
    return logMessage ?? String(error);
  }
  throw new Error("the declaration was accepted");
}

describe("the ids a place's reads may name", () => {
  it("names every id of each starting place's context but the reader's", () => {
    expectTypeOf<UnnamedPlaceStartupIds>().toBeNever();
    expect(PLACE_STARTUP_IDS["collection.edit"]).toEqual([
      "collection",
      "entryId",
    ]);
    expect(Object.keys(PLACE_STARTUP_IDS)).toEqual([
      "collection.edit",
      "single.edit",
      "entry.form",
    ]);
  });

  it("reads the ids a path names, in order", () => {
    expect(namedPlaceIds(DESIGN_READ)).toEqual(["collection", "entryId"]);
    expect(namedPlaceIds("/overview")).toEqual([]);
  });
});

describe("filling a read's path from the page's ids", () => {
  it("fills each id URI-component encoded, as a plugin builds its own path", () => {
    expect(
      fillPlaceStartupPath(DESIGN_READ, {
        collection: "posts",
        entryId: "a b&c",
      })
    ).toBe(
      `/templates/entry-designs?collection=posts&entry=${encodeURIComponent("a b&c")}`
    );
  });

  it.each([
    ["absent", {}],
    ["null, as a new entry's", { entryId: null }],
    ["empty", { entryId: "" }],
  ])("starts nothing for an id that is %s", (_case, entry) => {
    expect(
      fillPlaceStartupPath(DESIGN_READ, { collection: "posts", ...entry })
    ).toBeNull();
  });

  it("reads only the ids' own keys", () => {
    expect(fillPlaceStartupPath("/x/{constructor}", {})).toBeNull();
  });
});

describe("the boot check of a contribution's startup reads", () => {
  it("accepts a read naming the place's ids, and keeps it on the contribution", () => {
    const { contributions } = contributedAdminContributions([
      sectionWith([{ path: DESIGN_READ }]),
    ]);
    expect(contributions).toMatchObject([
      { id: "acme-designs.design", startupReads: [{ path: DESIGN_READ }] },
    ]);
  });

  it("refuses an id the place does not have, naming the plugin, the contribution and the path", () => {
    const message = refusal(
      sectionWith([{ path: "/designs?single={single}" }])
    );
    expect(message).toContain('Plugin "@acme/designs"');
    expect(message).toContain('"acme-designs.design"');
    expect(message).toContain('"/designs?single={single}" names {single}');
  });

  it.each(["dashboard", "collection.list", "user.detail", "account"])(
    "refuses startup reads at %s, where no page starts them, naming the places that do",
    place => {
      const message = refusal(sectionWith([{ path: "/totals" }], place));
      expect(message).toContain(`at "${place}"`);
      expect(message).toContain(
        '"collection.edit", "single.edit" and "entry.form"'
      );
    }
  );

  it("refuses startup reads on a list's row action, as on any kind", () => {
    const plugin: PluginDefinition = {
      name: "@acme/designs",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        admin: {
          contributions: [
            {
              id: "acme-designs.restyle",
              kind: "rowAction",
              place: "collection.list",
              label: "Restyle",
              action: { open: "@acme/designs/admin#Restyle" },
              startupReads: [{ path: "/styles" }],
            } as unknown as AdminContribution,
          ],
        },
      },
    };
    expect(refusal(plugin)).toContain('at "collection.list", where no page');
  });

  it("refuses startup reads at a plugin's own place", () => {
    const plugin: PluginDefinition = {
      name: "@acme/designs",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        admin: {
          places: [{ name: "acme-designs.board", accepts: ["block"] }],
          contributions: [
            {
              id: "acme-designs.summary",
              kind: "block",
              place: "acme-designs.board",
              component: "@acme/designs/admin#Summary",
              startupReads: [{ path: "/summary" }],
            } as unknown as AdminContribution,
          ],
        },
      },
    };
    expect(refusal(plugin)).toContain('at "acme-designs.board", where no page');
  });

  it.each(["{entry_id}", "{entryId2}", "{}", "{ entryId }"])(
    "refuses a brace %s that names none of the place's ids",
    braces => {
      expect(
        refusal(
          sectionWith([
            { path: `/designs?collection={collection}&entry=${braces}` },
          ])
        )
      ).toContain(braces);
    }
  );

  it("refuses a brace left open or closed alone", () => {
    expect(
      refusal(sectionWith([{ path: "/designs?entry={entryId" }]))
    ).toContain("/designs?entry={entryId");
    expect(refusal(sectionWith([{ path: "/designs?entry=}" }]))).toContain(
      "a brace"
    );
  });

  it("starts reads at an entry's form, with its kind, slug and id", () => {
    expect(PLACE_STARTUP_IDS["entry.form"]).toEqual([
      "kind",
      "slug",
      "entryId",
    ]);
    expect(() =>
      contributedAdminContributions([
        sectionWith(
          [{ path: "/notes?{kind}={slug}&entry={entryId}" }],
          "entry.form"
        ),
      ])
    ).not.toThrow();
  });

  it("refuses more reads than the startup request takes", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ path: `/r${i}` }));
    expect(refusal(sectionWith(five))).toContain("at most 4");
  });

  it.each([
    ["no leading slash", "templates?collection={collection}"],
    ["a step out of the namespace", "/../secrets"],
  ])("refuses a path the admin could not ask for: %s", (_case, path) => {
    expect(refusal(sectionWith([{ path }]))).toContain(
      "is not a path the admin can ask for"
    );
  });

  it("refuses a list that is not one, and a read with no path", () => {
    expect(refusal(sectionWith("/designs"))).toContain("is not a list");
    expect(refusal(sectionWith([{ mount: "root" }]))).toContain("no path");
  });
});

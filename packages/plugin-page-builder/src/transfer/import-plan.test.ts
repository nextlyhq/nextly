import {
  COMPONENT_INSTANCE_TYPE,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { planImport, renamedSlugs, type ImportSite } from "./import-plan";
import type { TransferFile } from "./transfer-contract";

function site(overrides: Partial<ImportSite> = {}): ImportSite {
  const none = { bySlug: new Map(), taken: new Set<string>() };
  return {
    items: { component: none, pattern: none, layout: none },
    classes: [],
    tokens: [],
    breakpoints: { viewport: [], container: [] },
    media: new Map(),
    isRegistered: () => true,
    mayAddBreakpoints: true,
    ...overrides,
  };
}

function file(overrides: Partial<TransferFile> = {}): TransferFile {
  return {
    format: "nextly-page-builder-transfer",
    formatVersion: 1,
    exportedAt: "2026-11-03T00:00:00.000Z",
    root: { kind: "component", id: "a" },
    components: [component("a", [])],
    patterns: [],
    layouts: [],
    classes: [],
    tokens: [],
    breakpoints: [],
    media: [],
    blockTypes: [],
    ...overrides,
  };
}

function component(id: string, nodes: BlockNode[]) {
  return {
    id,
    title: `Title ${id}`,
    slug: `slug-${id}`,
    status: "published" as const,
    content: { formatVersion: 1 as const, kind: "component" as const, nodes },
  };
}

const placing = (to: string): BlockNode => ({
  id: `p-${to}`,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: to },
});

describe("planImport", () => {
  it("adds what the site lacks, and creates components after the ones they place", () => {
    const plan = planImport(
      file({
        components: [component("a", [placing("b")]), component("b", [])],
      }),
      site()
    );
    expect(plan.preview.ready).toBe(true);
    expect(plan.preview.conflicts).toEqual([]);
    expect(plan.componentOrder).toEqual(["b", "a"]);
    expect(plan.items.component.get("a")).toEqual({
      action: "create",
      title: "Title a",
      slug: "slug-a",
    });
  });

  it("refuses a loop among the file's components, naming the chain", () => {
    const plan = planImport(
      file({
        components: [
          component("a", [placing("b")]),
          component("b", [placing("a")]),
        ],
      }),
      site()
    );
    expect(plan.preview.ready).toBe(false);
    expect(plan.preview.problems).toEqual([
      {
        code: "COMPONENT_CYCLE",
        message: expect.stringContaining("Title a → Title b → Title a"),
      },
    ]);
    expect(plan.componentOrder).toEqual([]);
  });

  it("refuses a placement of a component the file does not carry", () => {
    const plan = planImport(
      file({ components: [component("a", [placing("gone")])] }),
      site()
    );
    expect(plan.preview.problems.map(problem => problem.code)).toEqual([
      "MISSING_REFERENCE",
    ]);
  });

  it("renames a clashing item by default and uses the existing one when chosen", () => {
    const clashing = site({
      items: {
        component: {
          bySlug: new Map([
            ["slug-a", { id: "mine", title: "Mine", slug: "slug-a" }],
          ]),
          taken: new Set(["slug-a", "slug-a-2"]),
        },
        pattern: { bySlug: new Map(), taken: new Set() },
        layout: { bySlug: new Map(), taken: new Set() },
      },
    });
    const renamed = planImport(file(), clashing);
    expect(renamed.preview.conflicts).toEqual([
      {
        key: "component:a",
        kind: "component",
        fileId: "a",
        name: "Title a",
        existing: { id: "mine", name: "Mine" },
        renamedTo: "Title a (3)",
        choice: "rename",
      },
    ]);
    expect(renamed.items.component.get("a")).toEqual({
      action: "create",
      title: "Title a (3)",
      slug: "slug-a-3",
    });

    const existing = planImport(file(), clashing, {
      conflicts: { "component:a": "existing" },
    });
    expect(existing.items.component.get("a")).toEqual({
      action: "existing",
      id: "mine",
    });
    expect(existing.componentOrder).toEqual([]);
  });

  it("does not reuse a look for a shared style of one name and one look", () => {
    // The file's box style and the site's button look: same slug, same
    // styles, different binding. Reused, a box would wear a button's look.
    const styles = { base: { base: { color: "red" } } };
    const plan = planImport(
      file({
        classes: [{ id: "c1", slug: "button-outline", orderIndex: 0, styles }],
      }),
      site({
        classes: [
          {
            id: "look:core/button:outline",
            slug: "button-outline",
            orderIndex: 0,
            blockType: "core/button",
            styles,
          },
        ],
      })
    );
    expect(plan.preview.reused.filter(entry => entry.kind === "class")).toEqual(
      []
    );
  });

  it("reuses an identical shared style and variable, and settles a different one", () => {
    const plan = planImport(
      file({
        classes: [
          {
            id: "c1",
            slug: "card",
            orderIndex: 0,
            styles: { base: { base: { color: "red" } } },
          },
          {
            id: "c2",
            slug: "hero",
            orderIndex: 1,
            styles: { base: { base: { color: "red" } } },
          },
        ],
        tokens: [
          { name: "color.a", kind: "color", values: { light: "#111111" } },
          { name: "color.b", kind: "color", values: { light: "#222222" } },
        ],
      }),
      site({
        classes: [
          {
            id: "x1",
            slug: "card",
            orderIndex: 0,
            styles: { base: { base: { color: "red" } } },
          },
          { id: "x2", slug: "hero", orderIndex: 1, styles: {} },
        ],
        tokens: [
          { name: "color.a", kind: "color", values: { light: "#111111" } },
          { name: "color.b", kind: "color", values: { light: "#999999" } },
        ],
      })
    );
    expect(
      plan.preview.reused.map(entry => [
        entry.kind,
        entry.fileId,
        entry.existingId,
      ])
    ).toEqual([
      ["token", "color.a", "color.a"],
      ["class", "c1", "x1"],
    ]);
    expect(
      plan.preview.conflicts.map(entry => [entry.key, entry.renamedTo])
    ).toEqual([
      ["token:color.b", "color.b-2"],
      ["class:c2", "hero-2"],
    ]);
    expect(plan.classes.map.get("c1")).toBe("x1");
    expect(plan.classes.create.map(entry => [entry.id, entry.slug])).toEqual([
      ["c2", "hero-2"],
    ]);
    expect(plan.tokens.map.get("color.b")).toBe("color.b-2");
    expect(plan.tokens.create.map(token => token.name)).toEqual(["color.b-2"]);
  });

  it("does not reuse a shared style whose variable the import renames", () => {
    const styles = { base: { base: { color: { $token: "color.brand" } } } };
    const plan = planImport(
      file({
        classes: [{ id: "c1", slug: "card", orderIndex: 0, styles }],
        tokens: [
          { name: "color.brand", kind: "color", values: { light: "#123456" } },
        ],
      }),
      site({
        classes: [{ id: "x1", slug: "card", orderIndex: 0, styles }],
        tokens: [
          { name: "color.brand", kind: "color", values: { light: "#000000" } },
        ],
      })
    );
    // The file's card draws the file's brand colour, renamed on the way in,
    // so it is not the card this site holds.
    expect(plan.preview.reused).toEqual([]);
    expect(plan.preview.conflicts.map(entry => entry.key)).toEqual([
      "token:color.brand",
      "class:c1",
    ]);
    expect(plan.classes.map.get("c1")).toBe("c1");
  });

  it("reuses an identical media file and settles one with the same name", () => {
    const entry = (id: string) => ({
      id,
      filename: `${id}.png`,
      mimeType: "image/png",
      size: 1,
      sha256: "0".repeat(64),
      data: "AA==",
    });
    const plan = planImport(
      file({ media: [entry("same"), entry("named"), entry("new")] }),
      site({
        media: new Map([
          ["same", { identical: { id: "m1", filename: "same.png" } }],
          ["named", { sameName: { id: "m2", filename: "named.png" } }],
        ]),
      }),
      { conflicts: {} }
    );
    expect(plan.media.get("same")).toEqual({ action: "existing", id: "m1" });
    expect(plan.media.get("named")).toEqual({
      action: "upload",
      filename: "named-2.png",
    });
    expect(plan.media.get("new")).toEqual({
      action: "upload",
      filename: "new.png",
    });
    expect(plan.preview.conflicts.map(conflict => conflict.key)).toEqual([
      "media:named",
    ]);
  });

  it("names a clash past every numbered rename the same way on every request", () => {
    const taken = new Set([
      "slug-a",
      ...Array.from({ length: 20 }, (_, n) => `slug-a-${String(n + 2)}`),
    ]);
    const crowded = site({
      items: {
        component: {
          bySlug: new Map([
            ["slug-a", { id: "mine", title: "Mine", slug: "slug-a" }],
          ]),
          taken,
        },
        pattern: { bySlug: new Map(), taken: new Set() },
        layout: { bySlug: new Map(), taken: new Set() },
      },
    });
    const first = planImport(file(), crowded);
    const second = planImport(file(), crowded);
    expect(first.items.component.get("a")).toEqual(
      second.items.component.get("a")
    );
    expect(first.preview.fingerprint).toBe(second.preview.fingerprint);
    expect(
      taken.has((first.items.component.get("a") as { slug: string }).slug)
    ).toBe(false);
  });

  it("refuses an item whose name and every rename are taken, rather than guess one", () => {
    const taken = new Set(["slug-a", ...renamedSlugs("slug-a")]);
    const plan = planImport(
      file(),
      site({
        items: {
          component: { bySlug: new Map(), taken },
          pattern: { bySlug: new Map(), taken: new Set() },
          layout: { bySlug: new Map(), taken: new Set() },
        },
      })
    );
    expect(plan.preview.problems.map(problem => problem.code)).toEqual([
      "NAME_UNAVAILABLE",
    ]);
    expect(plan.items.component.has("a")).toBe(false);
  });

  it("judges a site where a name became taken since the preview as a different preview", () => {
    const free = planImport(file(), site()).preview.fingerprint;
    const taken = planImport(
      file(),
      site({
        items: {
          component: { bySlug: new Map(), taken: new Set(["slug-a"]) },
          pattern: { bySlug: new Map(), taken: new Set() },
          layout: { bySlug: new Map(), taken: new Set() },
        },
      })
    ).preview.fingerprint;
    expect(taken).not.toBe(free);
  });

  it("does not follow a loop through a component pointed at one already here", () => {
    const clashing = site({
      items: {
        component: {
          bySlug: new Map([
            ["slug-b", { id: "mine", title: "Mine", slug: "slug-b" }],
          ]),
          taken: new Set(["slug-b"]),
        },
        pattern: { bySlug: new Map(), taken: new Set() },
        layout: { bySlug: new Map(), taken: new Set() },
      },
    });
    const plan = planImport(
      file({
        components: [
          component("a", [placing("b")]),
          component("b", [placing("a")]),
        ],
      }),
      clashing,
      { conflicts: { "component:b": "existing" } }
    );
    expect(plan.preview.problems).toEqual([]);
    expect(plan.componentOrder).toEqual(["a"]);
  });

  it("names a variable as an author knows it, its path beside", () => {
    const plan = planImport(
      file({
        tokens: [
          {
            name: "color.accent",
            label: "Accent",
            kind: "color",
            values: { light: "#0050ff" },
          },
        ],
      }),
      site()
    );
    expect(plan.preview.added).toEqual([
      { kind: "component", fileId: "a", name: "Title a" },
      {
        kind: "token",
        fileId: "color.accent",
        name: "Accent",
        detail: "color.accent",
      },
    ]);
  });

  it("judges an apply choosing otherwise than its preview as a different preview", () => {
    const clashing = site({
      items: {
        component: {
          bySlug: new Map([
            ["slug-a", { id: "mine", title: "Mine", slug: "slug-a" }],
          ]),
          taken: new Set(["slug-a"]),
        },
        pattern: { bySlug: new Map(), taken: new Set() },
        layout: { bySlug: new Map(), taken: new Set() },
      },
    });
    const renamed = planImport(file(), clashing).preview.fingerprint;
    const existing = planImport(file(), clashing, {
      conflicts: { "component:a": "existing" },
    }).preview.fingerprint;
    expect(existing).not.toBe(renamed);
  });

  it("refuses a file showing media it does not carry", () => {
    const plan = planImport(
      file({
        components: [
          component("a", [
            {
              id: "i",
              type: "core/image",
              version: 1,
              props: { mediaId: "m-gone" },
            },
          ]),
        ],
      }),
      site({ mediaProps: type => (type === "core/image" ? ["mediaId"] : []) })
    );
    expect(plan.preview.problems).toEqual([
      { code: "MISSING_REFERENCE", message: expect.stringContaining("m-gone") },
    ]);
  });

  it("lists block types the site has not registered and is not ready", () => {
    const plan = planImport(
      file({
        components: [
          component("a", [
            { id: "w", type: "acme/widget", version: 1, props: {} },
          ]),
        ],
      }),
      site({ isRegistered: type => type !== "acme/widget" })
    );
    expect(plan.preview.missingBlockTypes).toEqual(["acme/widget"]);
    expect(plan.preview.ready).toBe(false);
  });

  describe("breakpoints", () => {
    const styled: BlockNode = {
      id: "h",
      type: "core/heading",
      version: 1,
      props: {},
      styles: { base: { exact: { color: "red" }, near: { color: "red" } } },
      visibility: { devices: { hidden: false } },
    };
    const breakpoints = file({
      components: [component("a", [styled])],
      breakpoints: [
        { id: "exact", label: "Exact", axis: "viewport", maxWidth: 991 },
        { id: "near", label: "Near", axis: "viewport", maxWidth: 479 },
        { id: "hidden", label: "Hidden", axis: "viewport", maxWidth: 200 },
      ],
    });
    const destination = site({
      breakpoints: {
        viewport: [
          { id: "md", label: "Medium", maxWidth: 991 },
          { id: "sm", label: "Small", maxWidth: 480 },
        ],
        container: [],
      },
    });

    it("maps only an exact width, counts what each unmatched one carries, and waits for a choice", () => {
      const plan = planImport(breakpoints, destination);
      expect(
        plan.preview.breakpoints.matched.map(entry => [
          entry.fileId,
          entry.to.id,
        ])
      ).toEqual([["exact", "md"]]);
      expect(
        plan.preview.breakpoints.unmatched.map(entry => [
          entry.fileId,
          entry.styles,
          entry.hides,
        ])
      ).toEqual([
        ["near", 1, 0],
        ["hidden", 0, 1],
      ]);
      expect(plan.preview.problems.map(problem => problem.code)).toEqual([
        "BREAKPOINT_UNDECIDED",
        "BREAKPOINT_UNDECIDED",
      ]);
    });

    it("adds or drops as chosen", () => {
      const plan = planImport(breakpoints, destination, {
        breakpoints: { near: "add", hidden: "drop" },
      });
      expect(plan.preview.ready).toBe(true);
      expect(plan.addBreakpoints).toEqual([
        { axis: "viewport", id: "near", label: "Near", maxWidth: 479 },
      ]);
      expect([...plan.breakpoints]).toEqual([
        ["exact", "md"],
        ["near", "near"],
      ]);
    });

    it("does not offer add without the site right or on a full axis", () => {
      const withoutRight = planImport(
        breakpoints,
        { ...destination, mayAddBreakpoints: false },
        { breakpoints: { near: "add", hidden: "drop" } }
      );
      expect(
        withoutRight.preview.breakpoints.unmatched.every(entry => !entry.mayAdd)
      ).toBe(true);
      expect(
        withoutRight.preview.problems.map(problem => problem.code)
      ).toEqual(["BREAKPOINT_NOT_ADDABLE"]);

      const full = planImport(
        breakpoints,
        site({
          breakpoints: {
            viewport: [1, 2, 3, 4, 5, 6, 7].map(n => ({
              id: `b${String(n)}`,
              label: `B${String(n)}`,
              maxWidth: n === 1 ? 991 : 1000 + n,
            })),
            container: [],
          },
        })
      );
      expect(
        full.preview.breakpoints.unmatched.map(entry => entry.whyNotAdd)
      ).toEqual([
        expect.stringContaining("most it can hold"),
        expect.stringContaining("most it can hold"),
      ]);
    });

    it("judges a site whose breakpoint changed as a different preview", () => {
      const before = planImport(breakpoints, destination).preview.fingerprint;
      const after = planImport(breakpoints, {
        ...destination,
        breakpoints: {
          viewport: [
            { id: "md", label: "Medium", maxWidth: 990 },
            { id: "sm", label: "Small", maxWidth: 480 },
          ],
          container: [],
        },
      }).preview.fingerprint;
      expect(after).not.toBe(before);
      expect(planImport(breakpoints, destination).preview.fingerprint).toBe(
        before
      );
    });
  });
});

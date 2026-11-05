/**
 * What removing breakpoints strips from a stored value: every style under a
 * removed breakpoint, in every state, on every block (slot content included)
 * and in the page's own settings; each own hide there, carried so narrower
 * devices keep what they showed; and nothing else. Stripping twice is
 * stripping once, and a value that cannot be read whole is left, not stripped
 * in part.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  hiddenOnDevice,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  removalOf,
  stripBreakpointsStep,
  stripClasses,
  stripDocument,
} from "./strip";
import type { Removal } from "./strip";

type Node = Record<string, unknown>;

const TABLET = { id: "tablet", label: "Tablet", maxWidth: 900 };
const MOBILE = { id: "mobile", label: "Mobile", maxWidth: 600 };
const SMALL = { id: "small", label: "Small", maxWidth: 400 };

/** Removing Mobile from a site with Tablet, Mobile and Small. */
const removingMobile: Removal = {
  ids: new Set(["mobile"]),
  before: { viewport: [TABLET, MOBILE, SMALL], container: [] },
};

const heading = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

const page = (nodes: Node[], extra: Node = {}): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
    ...extra,
  }) as unknown as BlockDocument;

const FORM = {
  host: {
    kind: "collection" as const,
    slug: "pages",
    id: "p1",
    path: ["content"],
  },
  form: "published" as const,
};

describe("stripDocument", () => {
  it("drops every state's values under the removed breakpoint and keeps the rest", () => {
    const stripped = stripDocument(
      page([
        heading("a", {
          styles: {
            base: { base: { color: "#111" }, mobile: { color: "#222" } },
            hover: { mobile: { color: "#333" }, tablet: { color: "#444" } },
            focus: { mobile: { outline: "1px solid" } },
          },
        }),
      ]),
      removingMobile
    );
    expect(stripped.nodes[0]?.styles).toEqual({
      base: { base: { color: "#111" } },
      hover: { tablet: { color: "#444" } },
    });
  });

  it("strips a block inside a slot as well as at the top", () => {
    const stripped = stripDocument(
      page([
        {
          ...heading("box"),
          type: "core/box",
          slots: {
            children: [
              heading("inner", {
                styles: { base: { mobile: { color: "#222" } } },
              }),
            ],
          },
        },
      ]),
      removingMobile
    );
    const inner = (stripped.nodes[0]?.slots?.children ?? [])[0];
    expect(inner?.id).toBe("inner");
    expect(inner?.styles).toBeUndefined();
  });

  it("strips the page's own settings styles", () => {
    const stripped = stripDocument(
      page([], {
        settings: {
          title: "Kept",
          styles: { base: { base: { gap: "1rem" }, mobile: { gap: "2rem" } } },
        },
      }),
      removingMobile
    );
    expect(stripped.settings).toEqual({
      title: "Kept",
      styles: { base: { base: { gap: "1rem" } } },
    });
  });

  it("carries an own hide at the removed breakpoint to the narrower devices", () => {
    const before = removingMobile.before;
    const after = { viewport: [TABLET, SMALL], container: [] };
    const stored = page([
      heading("a", { visibility: { devices: { mobile: false } } }),
    ]);
    // CONTROL: before the removal the hide reaches Small, which stores nothing.
    expect(hiddenOnDevice(stored.nodes[0]?.visibility, before, "small")).toBe(
      true
    );

    const stripped = stripDocument(stored, removingMobile);
    const visibility = stripped.nodes[0]?.visibility;
    expect(Object.keys(visibility?.devices ?? {})).not.toContain("mobile");
    expect(hiddenOnDevice(visibility, after, "small")).toBe(true);
    expect(hiddenOnDevice(visibility, after, "tablet")).toBe(false);
  });

  it("leaves a document holding nothing under the removed breakpoint as the same document", () => {
    const stored = page([
      heading("a", {
        styles: { base: { tablet: { color: "#444" } } },
        visibility: { devices: { tablet: false } },
      }),
    ]);
    expect(stripDocument(stored, removingMobile)).toBe(stored);
  });

  it("changes nothing on a block that holds nothing under the removed breakpoint", () => {
    const untouched = heading("b", {
      styles: { base: { tablet: { color: "#444" } } },
      visibility: { devices: { base: true } },
      classes: ["card"],
    });
    const stripped = stripDocument(
      page([
        heading("a", { styles: { base: { mobile: { color: "#222" } } } }),
        untouched,
      ]),
      removingMobile
    );
    expect(stripped.nodes[1]).toBe(untouched);
    expect(stripped.nodes[0]).toEqual(heading("a"));
  });

  it("is idempotent: a stripped document strips to itself", () => {
    const once = stripDocument(
      page([
        heading("a", {
          styles: { base: { mobile: { color: "#222" } } },
          visibility: { devices: { mobile: false } },
        }),
      ]),
      removingMobile
    );
    expect(stripDocument(once, removingMobile)).toBe(once);
  });
});

describe("stripClasses", () => {
  it("strips each shared style's values under the removed breakpoint, locked ones too", () => {
    const kept = {
      id: "c-2",
      slug: "two",
      orderIndex: 1,
      styles: { base: { base: { color: "#1" } } },
    };
    const classes = [
      {
        id: "c-1",
        slug: "one",
        orderIndex: 0,
        locked: true,
        styles: { base: { base: { color: "#0" }, mobile: { color: "#9" } } },
      },
      kept,
    ];
    const stripped = stripClasses(classes, removingMobile.ids);
    expect(stripped).toEqual([
      { ...classes[0], styles: { base: { base: { color: "#0" } } } },
      kept,
    ]);
    expect(stripped[1]).toBe(kept);
  });

  it("answers the same list when no shared style holds a value there", () => {
    const classes = [
      {
        id: "c-1",
        slug: "one",
        orderIndex: 0,
        styles: { base: { tablet: { color: "#0" } } },
      },
    ];
    expect(stripClasses(classes, removingMobile.ids)).toBe(classes);
  });

  it("keeps a shared style's styles, empty, when all it held was under the removed breakpoint", () => {
    const [entry] = stripClasses(
      [
        {
          id: "c-1",
          slug: "one",
          orderIndex: 0,
          styles: { base: { mobile: { color: "#0" } } },
        },
      ],
      removingMobile.ids
    );
    expect(entry).toMatchObject({ styles: {} });
  });
});

describe("stripBreakpointsStep", () => {
  const step = stripBreakpointsStep(removingMobile);

  it("rewrites a value holding a style under the removed breakpoint", async () => {
    const outcome = await step(
      page([heading("a", { styles: { base: { mobile: { color: "#222" } } } })]),
      FORM
    );
    expect(outcome).toEqual({ kind: "rewritten", value: page([heading("a")]) });
  });

  it("reads a value stored as text, as SQLite hands it back", async () => {
    const outcome = await step(
      JSON.stringify(
        page([
          heading("a", { styles: { base: { mobile: { color: "#222" } } } }),
        ])
      ),
      FORM
    );
    expect(outcome).toEqual({ kind: "rewritten", value: page([heading("a")]) });
  });

  it("answers unchanged for its own output", async () => {
    const first = await step(
      page([heading("a", { visibility: { devices: { mobile: false } } })]),
      FORM
    );
    expect(first.kind).toBe("rewritten");
    const value = first.kind === "rewritten" ? first.value : undefined;
    expect(await step(value, FORM)).toEqual({ kind: "unchanged" });
  });

  it("refuses a value this version cannot interpret rather than stripping part of it", async () => {
    const unknownFormat = {
      ...page([
        heading("a", { styles: { base: { mobile: { color: "#222" } } } }),
      ]),
      formatVersion: DOCUMENT_FORMAT_VERSION + 1,
    };
    expect((await step(unknownFormat, FORM)).kind).toBe("refuse");
  });
});

describe("removalOf", () => {
  it("resolves the set the removal started from: the stored one, else the configured", () => {
    const run = {
      removedIds: ["mobile"],
      before: { viewport: [TABLET, MOBILE], container: [] },
    };
    expect(
      removalOf(run, undefined).before?.viewport.map(def => def.id)
    ).toEqual(expect.arrayContaining(["tablet", "mobile"]));
    const configured = { breakpoints: { viewport: [SMALL], container: [] } };
    const fromDefaults = removalOf(
      { removedIds: ["small"], before: null },
      configured
    );
    expect(fromDefaults.before?.viewport.map(def => def.id)).toContain("small");
    expect([...fromDefaults.ids]).toEqual(["small"]);
  });
});

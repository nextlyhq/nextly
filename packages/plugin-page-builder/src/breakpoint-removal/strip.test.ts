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
  removedIdsIn,
  stripBreakpointsStep,
  splitClass,
  splitDocument,
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

describe("splitDocument", () => {
  it("says what it took out of each block, a slot's included, and of the page's settings", () => {
    const hidden = { devices: { mobile: false } };
    const document = page(
      [
        heading("a", {
          styles: {
            base: { base: { color: "#111" }, mobile: { color: "#222" } },
            hover: { mobile: { color: "#333" } },
          },
        }),
        {
          ...heading("box"),
          type: "core/box",
          slots: {
            children: [heading("inner", { visibility: hidden })],
          },
        },
        heading("untouched", { styles: { base: { base: { color: "#9" } } } }),
      ],
      {
        settings: {
          styles: { base: { mobile: { gap: "2rem" } } },
        },
      }
    );
    const split = splitDocument(document, removingMobile);
    expect(split.fragment).toEqual({
      nodes: {
        a: {
          styles: {
            base: { mobile: { color: "#222" } },
            hover: { mobile: { color: "#333" } },
          },
        },
        inner: {
          visibility: {
            before: hidden,
            after: (split.document.nodes[1]?.slots?.children ?? [])[0]
              ?.visibility,
          },
        },
      },
      settingsStyles: { base: { mobile: { gap: "2rem" } } },
    });
    // The document it answers is the one the strip writes.
    expect(split.document).toEqual(stripDocument(document, removingMobile));
    expect(split.document).not.toEqual(document);
  });

  it("keeps a block whose id is __proto__ as one of its own", () => {
    const split = splitDocument(
      page([
        heading("__proto__", {
          styles: { base: { mobile: { color: "#222" } } },
        }),
      ]),
      removingMobile
    );
    // Through JSON, as the fragment is stored.
    const stored = JSON.parse(JSON.stringify(split.fragment)) as {
      nodes: Record<string, unknown>;
    };
    expect(Object.hasOwn(stored.nodes, "__proto__")).toBe(true);
    expect(stored.nodes["__proto__"]).toEqual({
      styles: { base: { mobile: { color: "#222" } } },
    });
  });

  it("answers the same document, and no fragment, when nothing is held there", () => {
    const document = page([
      heading("a", { styles: { base: { tablet: { color: "#1" } } } }),
    ]);
    const split = splitDocument(document, removingMobile);
    expect(split.document).toBe(document);
    expect(split.fragment).toBeUndefined();
  });
});

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

describe("splitClass", () => {
  it("takes a shared style's values under the removed breakpoint out, locked ones too, and says what they were", () => {
    const entry = {
      id: "c-1",
      slug: "one",
      orderIndex: 0,
      locked: true,
      styles: { base: { base: { color: "#0" }, mobile: { color: "#9" } } },
    };
    expect(splitClass(entry, removingMobile.ids)).toEqual({
      entry: { ...entry, styles: { base: { base: { color: "#0" } } } },
      removed: { base: { mobile: { color: "#9" } } },
    });
  });

  it("answers the same entry, and nothing removed, when it holds no value there", () => {
    const entry = {
      id: "c-2",
      slug: "two",
      orderIndex: 1,
      styles: { base: { tablet: { color: "#1" } } },
    };
    const split = splitClass(entry, removingMobile.ids);
    expect(split.entry).toBe(entry);
    expect(split.removed).toBeUndefined();
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

  it("strips a value the compiler would not write, and every block sharing an id", async () => {
    const outcome = await step(
      page([
        // Nothing the compiler writes: an empty entry, and one not a record.
        heading("a", {
          styles: { base: { mobile: {} }, hover: { mobile: "red" } },
        }),
        heading("twin", { styles: { base: { mobile: { color: "#222" } } } }),
        heading("twin", { visibility: { devices: { mobile: false } } }),
      ]),
      FORM
    );
    expect(outcome).toEqual({
      kind: "rewritten",
      // The hide is carried to Small, the next narrower device.
      value: page([
        heading("a"),
        heading("twin"),
        heading("twin", { visibility: { devices: { small: false } } }),
      ]),
    });
    const value = outcome.kind === "rewritten" ? outcome.value : undefined;
    expect(removedIdsIn(value, removingMobile.ids).size).toBe(0);

    // A document holding nothing else under Mobile is rewritten on its own.
    const onlyInvalid = await step(
      page([
        heading("a", {
          styles: { base: { mobile: {} }, hover: { mobile: "red" } },
        }),
      ]),
      FORM
    );
    expect(onlyInvalid).toEqual({
      kind: "rewritten",
      value: page([heading("a")]),
    });
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
      beforeEmitted: null,
    };
    expect(
      removalOf(run, undefined).before?.viewport.map(def => def.id)
    ).toEqual(expect.arrayContaining(["tablet", "mobile"]));
    const configured = { breakpoints: { viewport: [SMALL], container: [] } };
    const fromDefaults = removalOf(
      { removedIds: ["small"], before: null, beforeEmitted: null },
      configured
    );
    expect(fromDefaults.before?.viewport.map(def => def.id)).toContain("small");
    expect([...fromDefaults.ids]).toEqual(["small"]);
  });

  it("carries hides under the set recorded when the removal began, whatever the configured set is now", () => {
    // Begun on the configured set Tablet and Small; the code since configures
    // Small alone.
    const run = {
      removedIds: ["small"],
      before: null,
      beforeEmitted: { viewport: [TABLET, SMALL], container: [] },
    };
    const now = { breakpoints: { viewport: [SMALL], container: [] } };
    expect(removalOf(run, now).before?.viewport.map(def => def.id)).toEqual(
      expect.arrayContaining(["tablet", "small"])
    );
  });

  it("leaves out an id the site defines again", () => {
    const run = {
      removedIds: ["tablet", "mobile"],
      before: { viewport: [TABLET, MOBILE], container: [] },
      beforeEmitted: null,
    };
    expect([...removalOf(run, undefined, new Set(["tablet"])).ids]).toEqual([
      "mobile",
    ]);
  });
});

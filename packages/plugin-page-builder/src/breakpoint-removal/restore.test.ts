/**
 * Putting back what a breakpoint removal took out, into each value as it is
 * now: exactly what was there when nothing changed since, and nothing an
 * author changed since overwritten.
 *
 * @module breakpoint-removal/restore.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { HostAddress } from "../host-rewrite/contract";
import type { HostRead } from "../host-rewrite/rewrite";

import type { StoredFragment } from "./fragments";
import {
  fragmentsForValue,
  restoreClasses,
  restoreDocument,
  skippedDocuments,
} from "./restore";
import {
  splitClass,
  splitDocument,
  stripClass,
  type DocumentFragment,
  type Removal,
} from "./strip";

type Node = Record<string, unknown>;

const TABLET = { id: "tablet", label: "Tablet", maxWidth: 900 };
const MOBILE = { id: "mobile", label: "Mobile", maxWidth: 600 };
const SMALL = { id: "small", label: "Small", maxWidth: 400 };

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

/** A page holding something under Mobile in every place a strip reaches. */
const ORIGINAL = page(
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
        children: [
          heading("inner", { visibility: { devices: { mobile: false } } }),
        ],
      },
    },
    heading("narrow", {
      visibility: { devices: { small: false, mobile: true } },
    }),
  ],
  { settings: { styles: { base: { mobile: { gap: "2rem" } } } } }
);

/** The page stripped, and what the strip took out. */
function stripped(): { document: BlockDocument; fragment: DocumentFragment } {
  const split = splitDocument(ORIGINAL, removingMobile);
  if (split.fragment === undefined) throw new Error("nothing stripped");
  return { document: split.document, fragment: split.fragment };
}

describe("restoreDocument", () => {
  it("gives back exactly the page as it was when nothing changed since", () => {
    const { document, fragment } = stripped();
    const restored = restoreDocument(document, [fragment]);
    expect(restored.value).toEqual(ORIGINAL);
    expect(restored.skipped).toBe(0);
    expect(restored.restored).toBeGreaterThan(0);
  });

  it("keeps a value the author set under the breakpoint since, and counts it skipped", () => {
    const { document, fragment } = stripped();
    // Mobile defined again and styled anew before the undo.
    const edited = {
      ...document,
      nodes: document.nodes.map(node =>
        node.id === "a"
          ? {
              ...node,
              styles: {
                ...node.styles,
                base: {
                  ...(node.styles as { base: object }).base,
                  mobile: { color: "#999" },
                },
              },
            }
          : node
      ),
    } as BlockDocument;
    const restored = restoreDocument(edited, [fragment]);
    const a = restored.value.nodes.find(node => node.id === "a");
    expect(a?.styles).toEqual({
      base: { base: { color: "#111" }, mobile: { color: "#999" } },
      hover: { mobile: { color: "#333" } },
    });
    expect(restored.skipped).toBe(1);
  });

  it("skips a block deleted since, counting what it held", () => {
    const { document, fragment } = stripped();
    const without = {
      ...document,
      nodes: document.nodes.filter(node => node.id !== "a"),
    } as BlockDocument;
    const restored = restoreDocument(without, [fragment]);
    expect(restored.value.nodes.map(node => node.id)).toEqual([
      "box",
      "narrow",
    ]);
    // Its two values, one per state.
    expect(restored.skipped).toBe(2);
  });

  it("puts back only the removed device of a hide the author changed since", () => {
    const { document, fragment } = stripped();
    const narrow = document.nodes.find(node => node.id === "narrow");
    const changed = {
      ...document,
      nodes: document.nodes.map(node =>
        node.id === "narrow"
          ? { ...node, visibility: { devices: { tablet: false } } }
          : node
      ),
    } as BlockDocument;
    expect(narrow?.visibility).not.toEqual({ devices: { tablet: false } });
    const restored = restoreDocument(changed, [fragment]);
    expect(
      restored.value.nodes.find(node => node.id === "narrow")?.visibility
    ).toEqual({ devices: { tablet: false, mobile: true } });
  });

  it("applies a value's newest fragment first", () => {
    const { document } = stripped();
    const newest: DocumentFragment = {
      nodes: { a: { styles: { base: { mobile: { color: "#newest" } } } } },
    };
    const older: DocumentFragment = {
      nodes: { a: { styles: { base: { mobile: { color: "#older" } } } } },
    };
    const restored = restoreDocument(document, [newest, older]);
    expect(
      (
        restored.value.nodes.find(node => node.id === "a")?.styles as {
          base: { mobile: unknown };
        }
      ).base.mobile
    ).toEqual({ color: "#newest" });
    // The older one met the newer value: changed since, as far as it knows.
    expect(restored.skipped).toBe(1);
  });
});

describe("restoreClasses", () => {
  const ids = removingMobile.ids;
  const stored = {
    id: "c-1",
    slug: "one",
    orderIndex: 0,
    locked: true,
    styles: { base: { base: { color: "#0" }, mobile: { color: "#9" } } },
  };
  const coded = {
    id: "c-code",
    slug: "code",
    orderIndex: 1,
    styles: { base: { base: { color: "#1" }, mobile: { color: "#8" } } },
  };

  it("puts a stored class's values back, and takes out an override still exactly the strip's", () => {
    const one = splitClass(stored, ids);
    const fromCode = splitClass(coded, ids);
    const restored = restoreClasses(
      [one.entry, fromCode.entry],
      [coded as never],
      {
        classes: {
          "c-1": one.removed ?? {},
          "c-code": fromCode.removed ?? {},
        },
        overridden: ["c-code"],
      },
      ids
    );
    // The code's class applies again as it was: no override stored.
    expect(restored.value).toEqual([stored]);
    expect(restored.skipped).toBe(0);
  });

  it("keeps an override the author changed since, filling only what it lacks", () => {
    const fromCode = splitClass(coded, ids);
    const edited = {
      ...(stripClass(coded, ids) as object),
      styles: { base: { base: { color: "#edited" } } },
    };
    const restored = restoreClasses(
      [edited],
      [coded as never],
      { classes: { "c-code": fromCode.removed ?? {} }, overridden: ["c-code"] },
      ids
    );
    expect(restored.value).toEqual([
      {
        ...edited,
        styles: {
          base: { base: { color: "#edited" }, mobile: { color: "#8" } },
        },
      },
    ]);
  });

  it("counts a class deleted since as skipped", () => {
    const restored = restoreClasses(
      [],
      [],
      {
        classes: { "c-gone": { base: { mobile: { color: "#1" } } } },
        overridden: [],
      },
      ids
    );
    expect(restored.value).toEqual([]);
    expect(restored.skipped).toBe(1);
  });
});

/** A kept row of the page's fragment, for `host` and `form`. */
const keptRow = (
  host: HostAddress,
  form: "published" | "draft" = "published"
): StoredFragment => ({
  runId: "removal",
  host,
  form,
  fragment: stripped().fragment,
  keptAt: new Date(),
});

const PAGE_HOST: HostAddress = {
  kind: "collection",
  slug: "pages",
  id: "p1",
  path: ["content"],
};

describe("fragmentsForValue", () => {
  it("answers a value's fragments per form, and none for another field or document", () => {
    const rows = [
      keptRow(PAGE_HOST),
      keptRow(PAGE_HOST, "draft"),
      keptRow({ ...PAGE_HOST, path: ["aside"] }),
      keptRow({ ...PAGE_HOST, id: "p2" }),
    ];
    const forValue = fragmentsForValue(rows, undefined);
    const value = { kind: "collection", slug: "pages", id: "p1" } as const;
    expect(forValue({ ...value, field: "content" })).toHaveLength(2);
    expect(forValue({ ...value, field: "body" })).toEqual([]);
    expect(forValue({ ...value, id: "p3", field: "content" })).toEqual([]);
  });

  it("matches the default language whether a write names it or not", () => {
    const rows = [
      keptRow({ ...PAGE_HOST, locale: "en" }),
      keptRow({ ...PAGE_HOST, locale: "fr" }, "draft"),
    ];
    const forValue = fragmentsForValue(rows, "en");
    const value = {
      kind: "collection",
      slug: "pages",
      id: "p1",
      field: "content",
    } as const;
    // A write in the default language names none; it is the `en` row's.
    expect(forValue(value)).toEqual([[rows[0]?.fragment]]);
    expect(forValue({ ...value, locale: "fr" })).toEqual([[rows[1]?.fragment]]);
    expect(forValue({ ...value, locale: "de" })).toEqual([]);
  });
});

describe("skippedDocuments", () => {
  /** A read of the page answering `published` live, with no draft. */
  const reading =
    (published: HostRead["published"]) => async (): Promise<HostRead> => ({
      published,
      draft: null,
      liveState: "published",
    });

  it("counts nothing for a page whose values are all back", async () => {
    expect(
      await skippedDocuments(
        [keptRow(PAGE_HOST)],
        reading({ kind: "value", value: ORIGINAL })
      )
    ).toEqual([]);
  });

  it("counts a page changed since, with how many values stayed out", async () => {
    const { document } = stripped();
    const without = {
      ...document,
      nodes: document.nodes.filter(node => node.id !== "a"),
    } as BlockDocument;
    const edited = restoreDocument(without, [stripped().fragment]).value;
    expect(
      await skippedDocuments(
        [keptRow(PAGE_HOST)],
        reading({ kind: "value", value: edited })
      )
    ).toEqual([
      {
        kind: "collection",
        slug: "pages",
        id: "p1",
        values: 2,
        reason: "changed",
      },
    ]);
  });

  it("counts every value of a page deleted since as gone", async () => {
    const all = restoreDocument(stripped().document, [stripped().fragment]);
    expect(
      await skippedDocuments([keptRow(PAGE_HOST)], reading({ kind: "absent" }))
    ).toEqual([
      {
        kind: "collection",
        slug: "pages",
        id: "p1",
        values: all.restored,
        reason: "gone",
      },
    ]);
  });

  it("reads a value kept from a page with no lifecycle back from its one row", async () => {
    // Its one value is kept as `draft`, read from the live row: all back, so
    // nothing is skipped, where reading a draft that is not there would
    // count every value gone.
    const read = async (): Promise<HostRead> => ({
      published: { kind: "value", value: ORIGINAL },
      draft: null,
      liveState: null,
    });
    expect(await skippedDocuments([keptRow(PAGE_HOST, "draft")], read)).toEqual(
      []
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  layoutReferencesOf,
  MAX_LAYOUTS_SCANNED,
  type LayoutPage,
  type LayoutReader,
} from "./layout-component-usage";

/** A reader answering fixed lists, and recording what it was asked. */
function reader(by: { published?: unknown[]; draft?: unknown[] }): {
  read: LayoutReader;
  asked: string[];
} {
  const asked: string[] = [];
  const read: LayoutReader = async ({ variant, page }) => {
    asked.push(`${variant}:${page}`);
    const items = (variant === "published" ? by.published : by.draft) ?? [];
    return { items, hasNext: false } satisfies LayoutPage;
  };
  return { read, asked };
}

const layout = (id: string, title: string, areas: unknown) => ({
  id,
  title,
  areas,
});
const area = (name: string, component: unknown) => ({ area: name, component });

describe("which Layouts name a component", () => {
  it("names the Layout, the area and which stored form", async () => {
    const { read } = reader({
      published: [layout("l1", "Marketing", [area("header", "header-cmp")])],
    });

    expect(
      await layoutReferencesOf({ read, componentId: "header-cmp" })
    ).toEqual({
      references: [
        {
          layoutId: "l1",
          title: "Marketing",
          area: "header",
          variant: "published",
        },
      ],
      complete: true,
    });
  });

  it("counts a DRAFT Layout too", async () => {
    // A draft Layout is on no page yet, and deleting the component it names
    // breaks it the moment somebody publishes — by which time the cause is a
    // deletion nobody remembers.
    const { read, asked } = reader({
      draft: [layout("l2", "Next season", [area("footer", "footer-cmp")])],
    });

    const usage = await layoutReferencesOf({ read, componentId: "footer-cmp" });

    expect({ variants: usage.references.map(r => r.variant), asked }).toEqual({
      variants: ["draft"],
      asked: ["published:1", "draft:1"],
    });
  });

  it("reads a relationship whether it came back as an id or a document", async () => {
    // The caller chooses the read depth and this module does not. Handling one
    // shape would answer "no Layout names this" on every installation whose
    // caller populated — the direction that permits the delete.
    const { read } = reader({
      published: [
        layout("l1", "By id", [area("header", "cmp")]),
        layout("l2", "By document", [
          area("footer", { id: "cmp", title: "H" }),
        ]),
      ],
    });

    const usage = await layoutReferencesOf({ read, componentId: "cmp" });

    expect(usage.references.map(r => r.layoutId)).toEqual(["l1", "l2"]);
  });

  it("says NOTHING names it when nothing does, and says so completely", async () => {
    // The control for every case above: without it, a scan that reported every
    // Layout as a reference would satisfy them all.
    const { read } = reader({
      published: [layout("l1", "Marketing", [area("header", "other-cmp")])],
    });

    expect(
      await layoutReferencesOf({ read, componentId: "header-cmp" })
    ).toEqual({ references: [], complete: true });
  });

  it("survives a Layout it cannot read, without claiming it read one", async () => {
    // `areas` is a repeater stored as one JSON column, so a malformed value
    // reaches this intact. A shape it cannot read contributes nothing rather
    // than raising — but the SCAN is still complete, because every Layout was
    // examined.
    const { read } = reader({
      published: [
        null,
        42,
        { id: "no-areas" },
        { id: "areas-not-array", areas: "nope" },
        { areas: [area("header", "cmp")] }, // no id: cannot be named in a refusal
        layout("l1", "Real", [null, 7, area("header", "cmp")]),
      ],
    });

    expect(await layoutReferencesOf({ read, componentId: "cmp" })).toEqual({
      references: [
        { layoutId: "l1", title: "Real", area: "header", variant: "published" },
      ],
      complete: true,
    });
  });

  it("reports a scan it could not finish, rather than answering none", async () => {
    // The property the whole module turns on. A truncated scan answering
    // `references: []` says "no Layout uses this", which is the answer that
    // permits the delete this exists to refuse. Both halves are asserted: an
    // assertion on `complete` alone would pass on a scan that also lost the
    // references it HAD found.
    const many = Array.from({ length: MAX_LAYOUTS_SCANNED + 5 }, (_, i) =>
      layout(`l${i}`, `L${i}`, [area("header", i === 0 ? "cmp" : "other")])
    );
    const { read } = reader({ published: many });

    const usage = await layoutReferencesOf({ read, componentId: "cmp" });

    expect({
      complete: usage.complete,
      found: usage.references.map(r => r.layoutId),
    }).toEqual({ complete: false, found: ["l0"] });
  });

  it("answers an empty id without spending the scan", async () => {
    // Nothing can name an id that is not one, so this is COMPLETE rather than
    // merely empty — and it must not cost a read to say so.
    const { read, asked } = reader({ published: [layout("l1", "M", [])] });

    expect({
      usage: await layoutReferencesOf({ read, componentId: "" }),
      asked,
    }).toEqual({ usage: { references: [], complete: true }, asked: [] });
  });
});

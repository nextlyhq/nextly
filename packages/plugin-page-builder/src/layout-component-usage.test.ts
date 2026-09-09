import { describe, expect, it } from "vitest";

import {
  layoutReferencesOf,
  MAX_LAYOUTS_SCANNED,
  type LayoutPage,
  type LayoutReader,
  type LayoutRecord,
} from "./layout-component-usage";

/** A reader answering a fixed list, and recording what it was asked. */
function reader(records: LayoutRecord[]): {
  read: LayoutReader;
  asked: number[];
} {
  const asked: number[] = [];
  const read: LayoutReader = async ({ page }) => {
    asked.push(page);
    return { items: records, hasNext: false } satisfies LayoutPage;
  };
  return { read, asked };
}

const layout = (id: string, title: string, areas: unknown) => ({
  id,
  title,
  areas,
});
const area = (name: string, component: unknown) => ({ area: name, component });

/** A Layout with no pending edit, in the state it is stored in. */
const stored = (
  document: unknown,
  variant: "published" | "draft" = "published"
): LayoutRecord => ({ stored: document, variant, pending: null });

describe("which Layouts name a component", () => {
  it("names the Layout, the area and which stored form", async () => {
    const { read } = reader([
      stored(layout("l1", "Marketing", [area("header", "header-cmp")])),
    ]);

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
    const { read, asked } = reader([
      stored(
        layout("l2", "Next season", [area("footer", "footer-cmp")]),
        "draft"
      ),
    ]);

    const usage = await layoutReferencesOf({ read, componentId: "footer-cmp" });

    // ONE enumeration covering every state, rather than a pass per state.
    expect({ variants: usage.references.map(r => r.variant), asked }).toEqual({
      variants: ["draft"],
      asked: [1],
    });
  });

  it("scans a Layout's PENDING edit as well as the form it stores", async () => {
    // Two documents, one Layout. The stored form is what the site serves and
    // the pending edit is what it will serve, so a component named by either
    // is in use — and a pending reference reads as a draft one, because that
    // is what it is until somebody publishes.
    const { read } = reader([
      {
        stored: layout("l1", "Marketing", [area("header", "live-cmp")]),
        variant: "published",
        pending: layout("l1", "Marketing", [area("footer", "pending-cmp")]),
      },
    ]);

    expect(
      await layoutReferencesOf({ read, componentId: "pending-cmp" })
    ).toEqual({
      references: [
        {
          layoutId: "l1",
          title: "Marketing",
          area: "footer",
          variant: "draft",
        },
      ],
      complete: true,
    });
  });

  it("spends the budget per LAYOUT, not per form", async () => {
    // A Layout with a pending edit is two documents to inspect and one Layout.
    // Charging the budget per form would report a scan as truncated over a
    // population it had finished — and a truncated scan REFUSES, so an edited
    // site would find its components undeletable at half the stated bound.
    const many = Array.from({ length: MAX_LAYOUTS_SCANNED }, (_, i) => ({
      stored: layout(`l${i}`, `L${i}`, [
        area("header", i === 0 ? "cmp" : "other"),
      ]),
      variant: "published" as const,
      pending: layout(`l${i}`, `L${i}`, [area("footer", "other")]),
    }));
    const { read } = reader(many);

    const usage = await layoutReferencesOf({ read, componentId: "cmp" });

    expect({
      complete: usage.complete,
      found: usage.references.map(r => r.layoutId),
    }).toEqual({ complete: true, found: ["l0"] });
  });

  it("reads a relationship whether it came back as an id or a document", async () => {
    // The caller chooses the read depth and this module does not. Handling one
    // shape would answer "no Layout names this" on every installation whose
    // caller populated — the direction that permits the delete.
    const { read } = reader([
      stored(layout("l1", "By id", [area("header", "cmp")])),
      stored(
        layout("l2", "By document", [area("footer", { id: "cmp", title: "H" })])
      ),
    ]);

    const usage = await layoutReferencesOf({ read, componentId: "cmp" });

    expect(usage.references.map(r => r.layoutId)).toEqual(["l1", "l2"]);
  });

  it("says NOTHING names it when nothing does, and says so completely", async () => {
    // The control for every case above: without it, a scan that reported every
    // Layout as a reference would satisfy them all.
    const { read } = reader([
      stored(layout("l1", "Marketing", [area("header", "other-cmp")])),
    ]);

    expect(
      await layoutReferencesOf({ read, componentId: "header-cmp" })
    ).toEqual({ references: [], complete: true });
  });

  it("survives a Layout it cannot read, without claiming it read one", async () => {
    // `areas` is a repeater stored as one JSON column, so a malformed value
    // reaches this intact. A shape it cannot read contributes nothing rather
    // than raising — but the SCAN is still complete, because every Layout was
    // examined.
    const { read } = reader([
      stored(null),
      stored(42),
      stored({ id: "no-areas" }),
      stored({ id: "areas-not-array", areas: "nope" }),
      // No id: cannot be named in a refusal.
      stored({ areas: [area("header", "cmp")] }),
      stored(layout("l1", "Real", [null, 7, area("header", "cmp")])),
    ]);

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
      stored(
        layout(`l${i}`, `L${i}`, [area("header", i === 0 ? "cmp" : "other")])
      )
    );
    const { read } = reader(many);

    const usage = await layoutReferencesOf({ read, componentId: "cmp" });

    expect({
      complete: usage.complete,
      found: usage.references.map(r => r.layoutId),
    }).toEqual({ complete: false, found: ["l0"] });
  });

  it("answers an empty id without spending the scan", async () => {
    // Nothing can name an id that is not one, so this is COMPLETE rather than
    // merely empty — and it must not cost a read to say so.
    const { read, asked } = reader([stored(layout("l1", "M", []))]);

    expect({
      usage: await layoutReferencesOf({ read, componentId: "" }),
      asked,
    }).toEqual({ usage: { references: [], complete: true }, asked: [] });
  });
});

/**
 * How the Needs your attention card reads its answer: the server's order kept, counts as the
 * card writes them, failed items and reasons, and only links inside the admin.
 */
import { describe, expect, it } from "vitest";

import { attentionRows } from "./needs-attention-model";

const item = (fields: Record<string, unknown>) => ({
  id: "core/overdue-releases",
  kind: "overdue",
  label: "Overdue releases",
  count: 2,
  severity: "critical",
  link: "releases?tab=attention&reason=overdue",
  ...fields,
});

describe("attentionRows", () => {
  it("keeps the answer's order, which the server ranked, rather than sorting again", () => {
    // Out of the server's own rank on purpose: a card that sorted would put critical first.
    const rows = attentionRows({
      items: [
        item({ id: "seo/a", label: "A", severity: "warning", count: 1 }),
        item({ id: "core/stopped-releases", label: "Stopped", count: 9 }),
      ],
    });
    expect(rows.map(row => row.id)).toEqual(["seo/a", "core/stopped-releases"]);
  });

  it("writes each count as the card does: whole, a floor as N+, and 99+ past the cap", () => {
    const rows = attentionRows({
      items: [
        item({ id: "a/1", count: 7 }),
        item({ id: "a/2", count: 7, atLeast: true }),
        item({ id: "a/3", count: 150 }),
      ],
    });
    expect(rows.map(row => row.title)).toEqual([
      "Overdue releases · 7",
      "Overdue releases · 7+",
      "Overdue releases · 99+",
    ]);
    expect(rows.map(row => row.spoken)).toEqual([
      "Overdue releases: 7",
      "Overdue releases: 7 or more",
      "Overdue releases: 99 or more",
    ]);
  });

  it("draws a failed item by its label alone, with no count", () => {
    const [row] = attentionRows({ items: [item({ count: 0, failed: true })] });
    expect(row).toMatchObject({ failed: true, title: "Overdue releases" });
  });

  it("carries the reason when there is one, and none when there is not", () => {
    const [given, absent] = attentionRows({
      items: [
        item({ reason: "Still scheduled after its time." }),
        item({ id: "a/2" }),
      ],
    });
    expect(given.reason).toBe("Still scheduled after its time.");
    expect(absent).not.toHaveProperty("reason");
  });

  it("links only inside the admin, and leaves out what it cannot draw", () => {
    const rows = attentionRows({
      items: [
        item({ link: "collections/pages" }),
        item({ id: "a/2", link: "//elsewhere.example/x" }),
        item({ id: "a/3", link: "javascript:alert(1)" }),
        { id: "a/4" },
        "not an item",
      ],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].href).toMatch(/\/collections\/pages$/);
    expect(rows[1]).not.toHaveProperty("href");
    expect(rows[2]).not.toHaveProperty("href");
    expect(attentionRows(undefined)).toEqual([]);
    expect(attentionRows({ items: "x" })).toEqual([]);
  });
});

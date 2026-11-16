// An icon column's cell: the stored id as text.
//
// An id has no spaces to wrap at, so a long one ran past a narrow table cell and out of the
// mobile card. The cell cuts it short with an ellipsis inside the room it has and carries the
// whole id in its tooltip.
import type { FieldConfig } from "nextly/config";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntryTableCell } from "../EntryTableCell";

const field = { type: "icon", name: "badge" } as FieldConfig;

describe("EntryTableCell for an icon", () => {
  it("cuts a long id short within its cell and keeps it whole in the tooltip", () => {
    const id = "lucide:circle-arrow-out-up-right-and-a-much-longer-tail";
    render(
      <EntryTableCell
        field={field}
        value={id}
        entry={{ id: "e1", badge: id }}
        collectionSlug="posts"
      />
    );
    const code = screen.getByText(id);
    expect(code.tagName).toBe("CODE");
    // `truncate` clips and ends in an ellipsis only on a box with a width, so it is a block held
    // to the cell's width rather than an inline run of text.
    for (const name of ["block", "min-w-0", "max-w-full", "truncate"]) {
      expect(code.classList.contains(name), name).toBe(true);
    }
    expect(code.getAttribute("title")).toBe(id);
  });
});

/**
 * What a row of fields owes the widest content any of them can hold: a box.
 *
 * Field rows lay their fields on proportional grid tracks (`100fr`,
 * `50fr 50fr`, …). A bare `Nfr` track is `minmax(auto, Nfr)`, and that
 * `auto` minimum is the item's min-content — which a Code field can make
 * enormous: CodeMirror renders its document with `white-space: pre`, so one
 * long unwrapped line contributes its full width, the track grows past the
 * form panel, and the editor's content paints outside the field's border.
 *
 * The row therefore zeroes every item's automatic minimum (`min-w-0`), the
 * same cure flexbox/grid layouts give any scroll-container child: the track
 * sizes to its proportional share alone, and the wide line scrolls inside
 * CodeMirror's own scroller instead of widening the page.
 *
 * Asserted on the row's class contract rather than on laid-out geometry —
 * jsdom does no track sizing — with the field mounted so the selector has
 * the real child it addresses.
 */
import { render } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import type { CodeFieldConfig } from "nextly/config";

import { FieldRow } from "./FieldRow";

const codeField: CodeFieldConfig = {
  type: "code",
  name: "snippet",
  label: "Snippet",
};

/** Mounts the row inside a real form context, as the entry form does. */
function RowHarness() {
  const form = useForm();
  return (
    <FormProvider {...form}>
      <FieldRow fields={[codeField]} />
    </FormProvider>
  );
}

function row() {
  return render(<RowHarness />);
}

describe("FieldRow", () => {
  it("gives its items a zero minimum width so content cannot widen the track", () => {
    const { container } = row();
    // The row is the grid that carries the proportional track template.
    const grid = container.querySelector<HTMLElement>(".grid");
    if (!grid) throw new Error("field row grid not found");
    // Both halves of the item contract, as one: each child spans its track
    // (!w-full) AND may shrink below its content's width (min-w-0) — the
    // second is what keeps a long code line inside the field's border.
    expect(grid.className).toContain("[&>*]:!w-full");
    expect(grid.className).toContain("[&>*]:min-w-0");
  });
});

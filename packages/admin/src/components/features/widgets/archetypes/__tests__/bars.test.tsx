/**
 * What a `bars` card shows, and what it says to a reader who cannot see it.
 *
 * The lengths themselves are not asserted here — jsdom performs no layout, so a
 * bar's rendered width is not observable and `chart-scale.test.ts` asks that
 * question of the arithmetic directly. What IS observable, and what these cover,
 * is everything a chart can get wrong without being visibly broken: refusing the
 * wrong payload, naming a null bucket, disclosing a cap, and carrying a text
 * alternative and a real table.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { barsAccepts, barsBody } from "../bars";
import { CardEmpty } from "../../frame/states";
import { gridBounds } from "../../__tests__/grid-bounds";

const widget = (): DashboardWidget =>
  ({
    id: "acme/by-status",
    title: "Entries by status",
    archetype: "bars",
    size: gridBounds(4),
    query: { source: "collection:posts", op: "groupBy", groupBy: "status" },
  }) as DashboardWidget;

const grouped = (
  buckets: { value: string | null; count: number }[],
  truncated?: boolean
): WidgetResult => ({
  op: "groupBy",
  buckets,
  ...(truncated && { truncated }),
});

function draw(result: WidgetResult, definition = widget()) {
  const outcome = barsBody(result, definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  render(
    <>{outcome.empty ? <CardEmpty {...outcome.empty} /> : outcome.node}</>
  );
}

describe("the bars archetype", () => {
  it("refuses a payload that is not grouped buckets", () => {
    // A count carries a single number, and the tempting coercion -- drawing one
    // bar of it -- invents a comparison the query never asked for.
    const outcome = barsBody({ op: "count", total: 12 }, widget());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("count");
  });

  it("needs a query, and says so by name", () => {
    expect(barsAccepts({ archetype: "bars", title: "By status" })).toContain(
      "By status"
    );
    expect(
      barsAccepts({ archetype: "bars", query: { op: "groupBy" } })
    ).toBeUndefined();
  });

  it("names the bucket for rows whose value is null", () => {
    // A null bucket is a real answer -- "how many entries have no author" -- and
    // an empty label would read as a rendering fault rather than as a group.
    draw(grouped([{ value: null, count: 4 }]));
    expect(screen.getAllByText("(none)").length).toBeGreaterThan(0);
  });

  it("tells an EMPTY value apart from a missing one, in BOTH mediums", () => {
    // Two different answers: the column holds nothing, and the column holds a
    // blank string. `??` catches only the first, so an empty string rendered as
    // an empty label -- a bar and a table row with no name at all.
    draw(
      grouped([
        { value: null, count: 4 },
        { value: "", count: 2 },
      ])
    );
    const table = screen.getByRole("table");
    // Addressed by ACCESSIBLE NAME, which is what a screen reader announces.
    // Asserting the drawn text would pass while both rows spoke the same words.
    expect(
      within(table).getByRole("row", { name: /no value stored/ })
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("row", { name: /an empty value/ })
    ).toBeInTheDocument();
  });

  it("does not SPEAK a placeholder the same way as a value spelled like it", () => {
    // 🔴 The distinction was carried by italic and muted colour, which a screen
    // reader does not announce -- so an empty bucket and a stored "(empty)"
    // were two rows with one spoken name, and the readers who most need the
    // difference were the ones not given it.
    //
    // Exact separation is not achievable: no string can be reserved from a
    // column of arbitrary text, so a value spelled like the description would
    // still coincide. What is asserted is that the placeholder now SAYS what it
    // is rather than relying on a colour.
    draw(
      grouped([
        { value: "", count: 5 },
        { value: "(empty)", count: 8 },
      ])
    );
    const table = screen.getByRole("table");
    const placeholder = within(table).getByRole("row", {
      name: /an empty value/,
    });
    const literal = within(table).getByRole("row", { name: /\(empty\)/ });
    expect(placeholder).not.toBe(literal);
    expect(within(placeholder).getByText("5")).toBeInTheDocument();
    expect(within(literal).getByText("8")).toBeInTheDocument();
  });

  it("keeps a stored value that READS like a placeholder as its own row", () => {
    // A grouped column holds arbitrary text, so a row whose value is literally
    // "(none)" is a real group that happens to share the null bucket's wording.
    //
    // Keyed by that wording the two shared a React key. A single render cannot
    // see it -- React renders duplicate-keyed siblings and only WARNS -- so the
    // warning is the observable, and asserting the rows exist would pass either
    // way. The defect it prevents is across re-renders, where React keeps one
    // child per key and a count is left drawn beside a group it does not
    // belong to.
    const warnings: unknown[][] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        warnings.push(args);
      });
    try {
      draw(
        grouped([
          { value: "(none)", count: 7 },
          { value: null, count: 3 },
        ])
      );
    } finally {
      spy.mockRestore();
    }

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
    expect(warnings.some(args => String(args[0]).includes("same key"))).toBe(
      false
    );
  });

  it("carries a text alternative naming the group with the most", () => {
    // What a screen reader is given INSTEAD of the shapes. Without it the card
    // announces a title and then a run of unlabelled elements.
    draw(
      grouped([
        { value: "Published", count: 128 },
        { value: "Draft", count: 57 },
      ])
    );
    const graphic = screen.getByRole("group", { name: /Use the arrow keys/ });
    expect(graphic).toHaveAccessibleName(/Entries by status/);
    expect(graphic).toHaveAccessibleDescription(/Most: Published, 128/);
  });

  it("puts every bucket in a real table, with the count beside it", () => {
    draw(
      grouped([
        { value: "Published", count: 128 },
        { value: "Draft", count: 57 },
      ])
    );
    const table = screen.getByRole("table");
    // Addressed by ROW rather than by a bare text match: a count that rendered
    // against the wrong label would satisfy two independent `getByText` calls
    // while telling the reader the opposite of the truth.
    const row = within(table).getByRole("row", { name: /Draft/ });
    expect(within(row).getByText("57")).toBeInTheDocument();
  });

  it("discloses a cap rather than quietly showing a partial picture", () => {
    draw(grouped([{ value: "Published", count: 9 }], true));
    // The visible note under the bars; the description says it too, for a screen reader.
    expect(
      screen.getByText("More groups exist than are shown.")
    ).toBeInTheDocument();
  });

  it("says only part was checked when an empty answer is a floor, not that nothing matched", () => {
    // A source that stops at a work bound can find no group in what it read
    // while the rest still holds some: an empty floor is not an empty answer.
    draw({ op: "groupBy", buckets: [], atLeast: true });
    const empty = screen.getByTestId("card-empty");
    expect(empty).toHaveTextContent(/None found in what was checked/);
    expect(empty).toHaveTextContent(/only part of the content/);
    expect(empty).not.toHaveTextContent(/Nothing to compare yet/);
  });

  it("says nothing was matched rather than drawing an empty frame", () => {
    draw(grouped([]));
    // The frame's one empty state, worded for groups.
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      /Nothing to compare yet/
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("a breakdown names its groups as a person reads them", () => {
  // The server describes the grouped field: its label heads the value column and its value
  // labels name the bars, so a person reads "Needs review" rather than `needs_review`.
  const described = (buckets: { value: string | null; count: number }[]) =>
    ({
      op: "groupBy",
      buckets,
      field: {
        name: "stage",
        label: "Stage",
        type: "string",
        choices: [
          { value: "needs_review", label: "Needs review" },
          { value: "done", label: "Done" },
        ],
      },
    }) as WidgetResult;

  it("names each bar by its value's label and keeps the count beside it", () => {
    draw(
      described([
        { value: "needs_review", count: 12 },
        { value: "done", count: 3 },
      ])
    );

    const table = screen.getByRole("table");
    const row = within(table).getByRole("row", { name: /Needs review/ });
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("needs_review")).not.toBeInTheDocument();
  });

  it("heads the value column with the grouped field's label", () => {
    draw(described([{ value: "done", count: 3 }]));

    expect(
      within(screen.getByRole("table")).getByRole("columnheader", {
        name: "Stage",
      })
    ).toBeInTheDocument();
  });

  it("reads a stored value the field does not name as words, and keeps the null bucket's placeholder", () => {
    draw(
      described([
        { value: "archived", count: 2 },
        { value: null, count: 1 },
      ])
    );

    const table = screen.getByRole("table");
    // A choice field's value with no option is read as a label would be, not as stored.
    expect(
      within(table).getByRole("row", { name: /Archived/ })
    ).toBeInTheDocument();
    // The null bucket is named by what it means, as before the labels existed.
    expect(
      within(table).getByRole("row", { name: /no value stored/ })
    ).toBeInTheDocument();
  });

  it("names an empty stored value by its declared choice, as a list does", () => {
    // An option that stores "" on purpose ("None") is a choice, not missing data.
    draw({
      op: "groupBy",
      buckets: [{ value: "", count: 4 }],
      field: {
        name: "stage",
        label: "Stage",
        type: "string",
        choices: [{ value: "", label: "None" }],
      },
    } as WidgetResult);

    const table = screen.getByRole("table");
    const row = within(table).getByRole("row", { name: /None/ });
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(screen.queryByText("(empty)")).not.toBeInTheDocument();
  });
});

describe("a group's name where its field names no option for it", () => {
  const withChoices = (buckets: { value: string | null; count: number }[]) =>
    ({
      op: "groupBy",
      buckets,
      field: {
        name: "status",
        label: "Status",
        type: "string",
        choices: [{ value: "draft", label: "Draft" }],
      },
    }) as WidgetResult;

  it("reads a choice field's unnamed value as words, not as code", () => {
    draw(withChoices([{ value: "needs_review", count: 2 }]));
    expect(
      screen.getByRole("rowheader", { name: "Needs review" })
    ).toBeInTheDocument();
  });

  it("still names a value by its option where there is one", () => {
    draw(withChoices([{ value: "draft", count: 2 }]));
    expect(
      screen.getByRole("rowheader", { name: "Draft" })
    ).toBeInTheDocument();
  });

  it("draws a value of a field with no choices as it was written", () => {
    // Text people wrote is drawn as stored: "jane_doe" may be exactly how it is meant.
    draw(grouped([{ value: "jane_doe", count: 2 }]));
    expect(
      screen.getByRole("rowheader", { name: "jane_doe" })
    ).toBeInTheDocument();
  });
});

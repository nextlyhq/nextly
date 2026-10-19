/**
 * A chart of groups: the order, colour and words a reader of any card sees.
 *
 * Each test names the property it separates: an order the server sent rather than the chart's
 * own, a colour by position rather than by value, a description that names a top group the
 * floors cannot rank.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart, type GroupsChartGroup } from "../groups-chart";

afterEach(() => cleanup());

function group(
  value: string | null,
  count: number,
  label = value ?? "(none)"
): GroupsChartGroup {
  return { key: `v${value}`, value, label, count };
}

function drawAt(
  tier: SizeTier,
  groups: GroupsChartGroup[],
  options: { truncated?: boolean; floors?: boolean } = {}
) {
  render(
    <CardTierContext.Provider value={tier}>
      <GroupsChart
        title="Entries by status"
        labelHeading="Status"
        groups={groups}
        {...options}
      />
    </CardTierContext.Provider>
  );
}

const bars = () => screen.getAllByTestId("chart-group");
const names = () =>
  bars().map(bar => bar.firstElementChild?.firstElementChild?.textContent);

describe("the order groups are drawn in", () => {
  it("is by count, highest first, ties by label, whatever order they arrive in", () => {
    drawAt("large", [
      group("b", 4, "Beta"),
      group("a", 4, "Alpha"),
      group("c", 9, "Gamma"),
    ]);
    expect(names()).toEqual(["Gamma", "Alpha", "Beta"]);
  });
});

describe("a bar's colour", () => {
  it("is its group's value's shared chart colour, the same on every card", () => {
    // Published is slot 3 and draft slot 2 wherever they are drawn, and whatever their order.
    drawAt("medium", [
      group("draft", 9, "Draft"),
      group("published", 4, "Published"),
    ]);
    const fills = screen
      .getAllByTestId("chart-bar")
      .map(bar => bar.style.backgroundColor);
    expect(fills).toEqual(["var(--nx-chart-2)", "var(--nx-chart-3)"]);
  });

  it("does not follow the bar's position", () => {
    // The same two groups, the other way round by count: each keeps its colour.
    drawAt("medium", [
      group("draft", 1, "Draft"),
      group("published", 4, "Published"),
    ]);
    const fills = screen
      .getAllByTestId("chart-bar")
      .map(bar => bar.style.backgroundColor);
    expect(fills).toEqual(["var(--nx-chart-3)", "var(--nx-chart-2)"]);
  });
});

describe("a group's name and value", () => {
  it("are written beside its bar", () => {
    drawAt("medium", [group("published", 128, "Published")]);
    const bar = bars()[0] as HTMLElement;
    expect(within(bar).getByText("Published")).toBeInTheDocument();
    expect(within(bar).getByText("128")).toBeInTheDocument();
  });
});

describe("the text alternative", () => {
  it("says how many groups, the total and the group with the most", () => {
    drawAt("medium", [
      group("draft", 3, "Draft"),
      group("published", 5, "Published"),
    ]);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(
      "Entries by status: 2 groups, 8 in total. Most: Published, 5."
    );
  });

  it("says counts are lower bounds when they are, and names no group first", () => {
    // A ranking of lower bounds is a claim the chart cannot make.
    drawAt(
      "medium",
      [group("draft", 3, "Draft"), group("published", 5, "Published")],
      {
        floors: true,
      }
    );
    const description =
      screen.getByRole("img").getAttribute("aria-describedby") ?? "";
    const text = document.getElementById(description)?.textContent ?? "";
    expect(text).toMatch(/lower bounds/);
    expect(text).not.toMatch(/Most/);
  });
});

describe("groups the tier leaves out", () => {
  it("are counted under the chart", () => {
    drawAt(
      "small",
      [1, 2, 3, 4, 5].map(n => group(`g${n}`, 10 - n, `Group ${n}`))
    );
    expect(bars()).toHaveLength(3);
    expect(screen.getByText("2 more groups")).toBeInTheDocument();
  });
});

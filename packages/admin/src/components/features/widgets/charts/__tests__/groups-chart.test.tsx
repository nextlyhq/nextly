/**
 * A chart of groups: the order, colour and words a reader of any card sees.
 *
 * Each test names the property it separates: an order the server sent rather than the chart's
 * own, a colour by position rather than by status, a status colour claimed by a field that is no
 * status, a description that names a top group the floors cannot rank.
 *
 * The bars are the chart engine's, read from what it draws.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart, type GroupsChartGroup } from "../groups-chart";

import {
  CHART_WIDTH,
  prefersReducedMotion,
  sizeChartsInTests,
} from "./chart-env";

sizeChartsInTests();
afterEach(() => cleanup());

function group(
  value: string | null,
  count: number,
  label = value ?? "(none)"
): GroupsChartGroup {
  return { key: `v${value}`, value, label, count };
}

/** Draws the chart at `tier` and waits for the engine's drawing, which loads lazily. */
async function drawAt(
  tier: SizeTier,
  groups: GroupsChartGroup[],
  options: {
    truncated?: boolean;
    floors?: boolean;
    unit?: { one: string; other: string };
  } = {}
): Promise<HTMLElement> {
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
  return screen.findByTestId("chart-drawing");
}

/** The text of each row on one of the drawing's two columns: 0 the names, 1 the counts. */
const column = (drawing: HTMLElement, at: 0 | 1) =>
  [
    ...(drawing
      .querySelectorAll(".recharts-yAxis-tick-labels")
      [at]?.querySelectorAll("text") ?? []),
  ].map(text => text.textContent);

/** Each bar's colour, read through the series variable its container sets. */
const fills = (drawing: HTMLElement) =>
  [...drawing.querySelectorAll(".recharts-bar-rectangle path")].map(bar => {
    const name = /^var\((--color-g\d+)\)$/.exec(bar.getAttribute("fill") ?? "");
    return name ? drawing.style.getPropertyValue(name[1] as string) : null;
  });

/** Each bar's thickness, as the engine draws it. */
const thicknesses = (drawing: HTMLElement) =>
  [...drawing.querySelectorAll(".recharts-bar-rectangle path")].map(bar =>
    Number(bar.getAttribute("height"))
  );

describe("a bar's thickness", () => {
  const three = () => [group("a", 3), group("b", 2), group("c", 1)];

  it("is under half its row, so rows stay apart", async () => {
    // Drawn at its least height here, a row of 22 px: a bar of 45% of it.
    const drawing = await drawAt("medium", three());
    expect(thicknesses(drawing)).toEqual([10, 10, 10]);
  });

  it("stops at 16 px however tall a card makes its rows", async () => {
    const measured = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const measure = measured.getMockImplementation();
    measured.mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("recharts-responsive-container")
        ? DOMRect.fromRect({ width: CHART_WIDTH, height: 300 })
        : (measure?.call(this) ?? DOMRect.fromRect());
    });
    const drawing = await drawAt("medium", three());
    expect(thicknesses(drawing)).toEqual([16, 16, 16]);
  });
});

describe("the order groups are drawn in", () => {
  it("is by count, highest first, ties by label, whatever order they arrive in", async () => {
    const drawing = await drawAt("large", [
      group("b", 4, "Beta"),
      group("a", 4, "Alpha"),
      group("c", 9, "Gamma"),
    ]);
    expect(column(drawing, 0)).toEqual(["Gamma", "Alpha", "Beta"]);
  });
});

describe("a bar's colour", () => {
  it("is its status's pinned chart colour, the same on every card", async () => {
    // Published is slot 3 and draft slot 2 wherever they are drawn, and whatever their order.
    const drawing = await drawAt("medium", [
      group("draft", 9, "Draft"),
      group("published", 4, "Published"),
    ]);
    expect(fills(drawing)).toEqual(["var(--nx-chart-2)", "var(--nx-chart-3)"]);
  });

  it("does not follow the bar's position", async () => {
    // The same two groups, the other way round by count: each keeps its colour.
    const drawing = await drawAt("medium", [
      group("draft", 1, "Draft"),
      group("published", 4, "Published"),
    ]);
    expect(fills(drawing)).toEqual(["var(--nx-chart-3)", "var(--nx-chart-2)"]);
  });

  it("is the first chart colour for every bar of a field that is no status", async () => {
    // 🔴 Hashed colours made a card of arbitrary values a rainbow that said nothing.
    const drawing = await drawAt("medium", [
      group("gold", 3, "Gold"),
      group("silver", 2, "Silver"),
      group("draft", 1, "Draft"),
    ]);
    expect(fills(drawing)).toEqual([
      "var(--nx-chart-1)",
      "var(--nx-chart-1)",
      "var(--nx-chart-1)",
    ]);
  });

  it("keeps its status's colour on a small card that draws fewer bars than the answer holds", async () => {
    const statuses = ["published", "draft", "scheduled", "changes", "archived"];
    const drawing = await drawAt(
      "small",
      statuses.map((status, index) => group(status, 10 - index, status))
    );
    expect(fills(drawing)).toEqual([
      "var(--nx-chart-3)",
      "var(--nx-chart-2)",
      "var(--nx-chart-1)",
    ]);
  });
});

describe("a group's name and value", () => {
  it("are written on its bar's row, so colour is never the only cue", async () => {
    const drawing = await drawAt("medium", [
      group("published", 128, "Published"),
      group("draft", 7, "Draft"),
    ]);
    expect(column(drawing, 0)).toEqual(["Published", "Draft"]);
    expect(column(drawing, 1)).toEqual(["128", "7"]);
    const rowOf = (text: string) =>
      [...drawing.querySelectorAll("text")]
        .find(candidate => candidate.textContent === text)
        ?.getAttribute("y");
    expect(rowOf("Published")).toBe(rowOf("128"));
    expect(rowOf("Draft")).toBe(rowOf("7"));
  });

  it("are inside the drawing, the name from its left edge and the count to its right", async () => {
    const drawing = await drawAt("medium", [
      group("published", 128, "Published"),
    ]);
    const [name, count] = [
      ...drawing.querySelectorAll(".recharts-yAxis-tick-labels text"),
    ];
    expect(Number(name?.getAttribute("x"))).toBe(0);
    expect(name?.getAttribute("text-anchor")).toBe("start");
    expect(count?.getAttribute("text-anchor")).toBe("end");
    expect(Number(count?.getAttribute("x"))).toBeLessThanOrEqual(
      Number(drawing.querySelector("svg")?.getAttribute("width"))
    );
  });

  it("writes the group with no value in italic, apart from a stored value spelled the same", async () => {
    const drawing = await drawAt("medium", [
      { ...group(null, 2), announce: "no value stored" },
      group("(none)", 1, "(none)"),
    ]);
    const styles = [
      ...(drawing
        .querySelectorAll(".recharts-yAxis-tick-labels")[0]
        ?.querySelectorAll("text") ?? []),
    ].map(text => text.getAttribute("font-style"));
    expect(styles).toEqual(["italic", "normal"]);
  });
});

describe("the text alternative", () => {
  it("says how many groups, the total and the group with the most", async () => {
    await drawAt("medium", [
      group("draft", 3, "Draft"),
      group("published", 5, "Published"),
    ]);
    expect(
      screen.getByRole("group", { name: /Use the arrow keys/ })
    ).toHaveAccessibleDescription(
      "Entries by status: 2 groups, 8 in total. Most: Published, 5."
    );
  });

  it("says counts are lower bounds when they are, and names no group first", async () => {
    // A ranking of lower bounds is a claim the chart cannot make.
    await drawAt(
      "medium",
      [group("draft", 3, "Draft"), group("published", 5, "Published")],
      {
        floors: true,
      }
    );
    const description =
      screen
        .getByRole("group", { name: /Use the arrow keys/ })
        .getAttribute("aria-describedby") ?? "";
    const text = document.getElementById(description)?.textContent ?? "";
    expect(text).toMatch(/lower bounds/);
    expect(text).not.toMatch(/Most/);
  });
});

describe("the total a text alternative states", () => {
  const five = () =>
    [1, 2, 3, 4, 5].map(n => group(`g${n}`, 10 - n, `Group ${n}`));
  const described = () => {
    const id =
      screen
        .getByRole("group", { name: /Use the arrow keys/ })
        .getAttribute("aria-describedby") ?? "";
    return document.getElementById(id)?.textContent ?? "";
  };

  it("counts every group the answer holds, not only those the tier draws", async () => {
    // A small card draws three of five; its words still count all five (9+8+7+6+5 = 35).
    await drawAt("small", five());
    expect(described()).toBe(
      "Entries by status: 5 groups, 35 in total. Most: Group 1, 9."
    );
  });

  it("is not called a total when the answer itself left groups out", async () => {
    await drawAt("large", five(), { truncated: true });
    expect(described()).not.toMatch(/in total/);
    expect(described()).toMatch(/more groups exist/i);
  });
});

describe("groups the tier leaves out", () => {
  it("are counted under the chart", async () => {
    const drawing = await drawAt(
      "small",
      [1, 2, 3, 4, 5].map(n => group(`g${n}`, 10 - n, `Group ${n}`))
    );
    expect(column(drawing, 0)).toHaveLength(3);
    expect(screen.getByText("2 more groups")).toBeInTheDocument();
  });
});

describe("motion", () => {
  it("draws its bars without animation while the person asks for reduced motion", async () => {
    const drawing = await drawAt("medium", [
      group("published", 3, "Published"),
    ]);
    expect(drawing).toHaveAttribute("data-motion", "reduced");
    // Drawn whole at once: the bar is there on the first paint.
    expect(
      drawing.querySelectorAll(".recharts-bar-rectangle path")
    ).toHaveLength(1);
  });

  it("animates its bars in otherwise", async () => {
    prefersReducedMotion(false);
    const drawing = await drawAt("medium", [
      group("published", 3, "Published"),
    ]);
    expect(drawing).toHaveAttribute("data-motion", "animated");
    // Drawn, so the check below reads a bar that has not grown yet, not an empty chart.
    expect(
      drawing.querySelectorAll(".recharts-bar-background-rectangle")
    ).toHaveLength(1);
    // Grown from nothing: on the first paint the bar has no length to draw yet.
    expect(
      drawing.querySelectorAll(".recharts-bar-rectangle path")
    ).toHaveLength(0);
  });
});

describe("the tooltip of the group in view", () => {
  const POSTS = { one: "post", other: "posts" };
  const statuses = () => [
    group("published", 7, "Published"),
    group("draft", 3, "Draft"),
    group("archived", 1, "Archived"),
  ];
  const focus = async () =>
    act(() =>
      screen.getByRole("group", { name: /Use the arrow keys/ }).focus()
    );
  const tip = () =>
    screen
      .getByTestId("chart-tooltip")
      .closest<HTMLElement>("[data-chart-tooltip]");

  it("names the group over its count and what it counts, as the design writes it", async () => {
    await drawAt("medium", statuses(), { unit: POSTS });
    await focus();
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toHaveTextContent(/^Published7 posts$/);
  });

  it("writes one as one", async () => {
    await drawAt("medium", [group("draft", 1, "Draft")], { unit: POSTS });
    await focus();
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("1 post");
  });

  it("sits in the row under a group in the top half, ending at its long bar's end", async () => {
    await drawAt("medium", statuses(), { unit: POSTS });
    await focus();
    // The first of three rows, its bar the longest: the tooltip is in the second row, and
    // ends where the bar ends, so it covers neither that bar nor the names.
    expect(tip()?.style.top).toBe(`${(1 / 3) * 100}%`);
    expect(tip()?.style.right).toMatch(/^calc\(/);
    expect(tip()?.style.left).toBe("");
  });

  it("sits in the row over a group in the bottom half, starting at its short bar's end", async () => {
    await drawAt("medium", statuses(), { unit: POSTS });
    await focus();
    await userEvent.setup().keyboard("{End}");
    expect(tip()?.style.bottom).toBe(`${(1 / 3) * 100}%`);
    expect(tip()?.style.left).toMatch(/^calc\(80px \+ 8px|^calc\(88px/);
  });
});

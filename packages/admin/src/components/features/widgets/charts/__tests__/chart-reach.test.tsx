/**
 * A chart's values reached by keyboard, by pointer and by screen reader.
 *
 * One tab stop per chart; inside it the arrow keys move the current point, which a polite live
 * region reads and a tooltip shows; Escape dismisses the tooltip; a hovered mark shows its value
 * while the mark or its tooltip is hovered.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import type { SizeTier } from "@nextlyhq/ui/format";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart, type GroupsChartGroup } from "../groups-chart";
import { OverTimeChart, type OverTimeSeries } from "../over-time-chart";

afterEach(() => cleanup());

function group(value: string, count: number, label: string): GroupsChartGroup {
  return { key: `v${value}`, value, label, count };
}

function drawGroups(tier: SizeTier = "medium") {
  return render(
    // The admin shell's shortcut owner, on the document as there, so Escape reaches a hovered
    // chart's binding with focus anywhere.
    <ShortcutProvider>
      <CardTierContext.Provider value={tier}>
        <GroupsChart
          title="Entries by status"
          labelHeading="Status"
          groups={[
            group("published", 128, "Published"),
            group("draft", 57, "Draft"),
            group("archived", 3, "Archived"),
          ]}
        />
      </CardTierContext.Provider>
    </ShortcutProvider>
  );
}

const days = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    key: `d${i + 1}`,
    label: `Day ${i + 1}`,
  }));

function line(name: string, values: number[]): OverTimeSeries {
  return {
    key: name,
    name,
    points: values.map((value, i) => ({ key: `d${i + 1}`, value })),
  };
}

function drawOverTime(series: OverTimeSeries[], tier: SizeTier = "medium") {
  return render(
    // The admin shell's shortcut owner, on the document as there, so Escape reaches a hovered
    // chart's binding with focus anywhere.
    <ShortcutProvider>
      <CardTierContext.Provider value={tier}>
        <OverTimeChart
          title="Posts created"
          intervals={days(3)}
          series={series}
        />
      </CardTierContext.Provider>
    </ShortcutProvider>
  );
}

const chart = (how: RegExp) => screen.getByRole("group", { name: how });
const live = () => screen.getByTestId("chart-live");
const tooltip = () => screen.queryByTestId("chart-tooltip");

describe("a chart's one tab stop", () => {
  it("is the chart itself, named by what it shows and how to read it", () => {
    const { container } = drawGroups();
    const reach = chart(
      /Entries by status\. Use the arrow keys to read each bar\./
    );
    expect(reach).toHaveAttribute("tabindex", "0");
    // Nothing else in the chart takes a tab stop: the marks are reached with the arrow keys.
    expect(
      container.querySelectorAll("[tabindex]:not([tabindex='-1'])")
    ).toHaveLength(1);
  });
});

describe("a chart of groups, from the keyboard", () => {
  it("starts at the first bar, announces it and shows its tooltip", async () => {
    drawGroups();
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(
      chart(/Use the arrow keys to read each bar/)
    );
    expect(live()).toHaveTextContent("Published: 128.");
    expect(tooltip()).toHaveTextContent(/Published/);
    expect(tooltip()).toHaveTextContent(/128/);
  });

  it("moves bar by bar with the arrows, and to the ends with Home and End", async () => {
    drawGroups();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(live()).toHaveTextContent("Draft: 57.");
    await user.keyboard("{End}");
    expect(live()).toHaveTextContent("Archived: 3.");
    await user.keyboard("{Home}");
    expect(live()).toHaveTextContent("Published: 128.");
    // Nothing wraps: Up at the first bar stays there.
    await user.keyboard("{ArrowUp}");
    expect(live()).toHaveTextContent("Published: 128.");
  });

  it("hides its tooltip on Escape, and shows it again on the next move", async () => {
    drawGroups();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(tooltip()).toHaveTextContent(/Draft/);
  });

  it("hides its tooltip when focus leaves", async () => {
    drawGroups();
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(tooltip()).toBeNull();
  });
});

describe("a chart of groups, by pointer", () => {
  it("shows a bar's value while it is hovered, and hides it when the pointer leaves", async () => {
    // That moving onto the tooltip keeps it (WCAG 1.4.13) is checked in the browser suite:
    // jsdom's pointer events carry no related target, so React reads any move as leaving.
    drawGroups();
    const user = userEvent.setup();
    const draft = screen.getAllByTestId("chart-group")[1] as HTMLElement;
    await user.hover(draft);
    expect(tooltip()).toHaveTextContent(/Draft/);
    expect(tooltip()).toHaveTextContent(/57/);
    await user.unhover(chart(/Use the arrow keys to read each bar/));
    expect(tooltip()).toBeNull();
  });

  it("dismisses a hovered tooltip on Escape", async () => {
    drawGroups();
    const user = userEvent.setup();
    await user.hover(screen.getAllByTestId("chart-group")[0] as HTMLElement);
    expect(tooltip()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
  });
});

describe("a chart over time, by pointer", () => {
  it("shows every series' value in the hovered interval", async () => {
    drawOverTime([line("Posts", [2, 9, 4]), line("Pages", [1, 5, 3])]);
    const user = userEvent.setup();
    await user.hover(screen.getAllByTestId("chart-interval")[1] as HTMLElement);
    expect(tooltip()).toHaveTextContent(/Day 2/);
    expect(tooltip()).toHaveTextContent(/Posts\s*9/);
    expect(tooltip()).toHaveTextContent(/Pages\s*5/);
    // Each series' point in that interval is marked, not only the line's latest.
    expect(screen.getAllByTestId("chart-point-in-view")).toHaveLength(2);
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
  });

  it("reads an interval a series has no point in as having none", async () => {
    render(
      <ShortcutProvider>
        <CardTierContext.Provider value="medium">
          <OverTimeChart
            title="Posts created"
            intervals={days(3)}
            series={[
              line("Posts", [2, 9, 4]),
              {
                key: "Pages",
                name: "Pages",
                points: [{ key: "d1", value: 1 }],
              },
            ]}
          />
        </CardTierContext.Provider>
      </ShortcutProvider>
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(live()).toHaveTextContent("Pages, Day 3: no value.");
  });
});

describe("a chart over time, from the keyboard", () => {
  it("starts at the latest point and moves along the line", async () => {
    drawOverTime([line("Posts", [2, 9, 4])]);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(
      chart(/Use the arrow keys to read each point/)
    );
    expect(live()).toHaveTextContent("Day 3: 4.");
    await user.keyboard("{ArrowLeft}");
    expect(live()).toHaveTextContent("Day 2: 9.");
    expect(tooltip()).toHaveTextContent(/Day 2/);
    expect(tooltip()).toHaveTextContent(/9/);
  });

  it("moves between series with Up and Down, naming the series", async () => {
    drawOverTime([line("Posts", [2, 9, 4]), line("Pages", [1, 5, 3])]);
    const user = userEvent.setup();
    await user.tab();
    expect(live()).toHaveTextContent("Posts, Day 3: 4.");
    await user.keyboard("{ArrowDown}");
    expect(live()).toHaveTextContent("Pages, Day 3: 3.");
  });
});

describe("the tooltip", () => {
  it("is drawn on the popover surface, with its mark's chart colour", async () => {
    drawGroups();
    await userEvent.setup().tab();
    const tip = tooltip() as HTMLElement;
    expect(tip).toHaveClass("bg-popover");
    const swatch = within(tip).getByTestId("chart-tooltip-swatch");
    expect(swatch.style.backgroundColor).toBe("var(--nx-chart-3)");
  });
});

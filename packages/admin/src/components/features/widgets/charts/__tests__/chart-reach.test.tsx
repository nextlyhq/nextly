/**
 * A chart's values reached by keyboard, by pointer and by screen reader.
 *
 * One tab stop per chart; inside it the arrow keys move the current point, which a polite live
 * region reads and a tooltip shows; Escape dismisses the tooltip; a hovered mark shows its value
 * while the mark or its tooltip is hovered.
 *
 * The marks are the chart engine's, and so is the pointer's reading of which mark it is over: a
 * test moves the pointer to a mark's own coordinates in the engine's drawing (`chart-env`).
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import type { SizeTier } from "@nextlyhq/ui/format";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart, type GroupsChartGroup } from "../groups-chart";
import { OverTimeChart, type OverTimeSeries } from "../over-time-chart";

import { pointAtInterval, pointAtRow, sizeChartsInTests } from "./chart-env";

sizeChartsInTests();
afterEach(() => cleanup());

function group(value: string, count: number, label: string): GroupsChartGroup {
  return { key: `v${value}`, value, label, count };
}

const STATUSES = [
  group("published", 128, "Published"),
  group("draft", 57, "Draft"),
  group("archived", 3, "Archived"),
];

/** A chart of groups, with `beside` drawn next to it (a field to type in, say). */
function groupsTree(groups: GroupsChartGroup[] = STATUSES, beside?: ReactNode) {
  return (
    // The admin shell's shortcut owner, on the document as there, so Escape reaches a hovered
    // chart's binding with focus anywhere.
    <ShortcutProvider>
      <CardTierContext.Provider value="medium">
        {beside}
        <GroupsChart
          title="Entries by status"
          labelHeading="Status"
          groups={groups}
        />
      </CardTierContext.Provider>
    </ShortcutProvider>
  );
}

/** Renders `tree` and waits for the engine's drawing, which loads lazily. */
async function drawn(tree: ReactNode) {
  const result = render(tree);
  const drawing = await screen.findByTestId("chart-drawing");
  return { ...result, drawing };
}

function drawGroups() {
  return drawn(groupsTree());
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
  return drawn(
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
  it("is the chart itself, named by what it shows and how to read it", async () => {
    const { container } = await drawGroups();
    const reach = chart(
      /Entries by status\. Use the arrow keys to read each bar\./
    );
    expect(reach).toHaveAttribute("tabindex", "0");
    // Nothing else in the chart takes a tab stop, the engine's drawing included: the marks are
    // reached with the arrow keys.
    expect(
      container.querySelectorAll("[tabindex]:not([tabindex='-1'])")
    ).toHaveLength(1);
  });
});

describe("a chart of groups, from the keyboard", () => {
  it("starts at the first bar, announces it and shows its tooltip", async () => {
    await drawGroups();
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(
      chart(/Use the arrow keys to read each bar/)
    );
    expect(live()).toHaveTextContent("Published: 128.");
    expect(tooltip()).toHaveTextContent(/Published/);
    expect(tooltip()).toHaveTextContent(/128/);
  });

  it("moves bar by bar with the arrows, and to the ends with Home and End", async () => {
    await drawGroups();
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
    await drawGroups();
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(tooltip()).toHaveTextContent(/Draft/);
  });

  it("hides its tooltip when focus leaves", async () => {
    await drawGroups();
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
    const { drawing } = await drawGroups();
    await pointAtRow(drawing, 1);
    expect(tooltip()).toHaveTextContent(/Draft/);
    expect(tooltip()).toHaveTextContent(/57/);
    // Left as a pointer leaves it: the moves above were the engine's to read, so user-event,
    // which leaves only what it saw the pointer enter, has nothing to leave.
    fireEvent.pointerLeave(chart(/Use the arrow keys to read each bar/));
    expect(tooltip()).toBeNull();
  });

  it("dismisses a hovered tooltip on Escape", async () => {
    const { drawing } = await drawGroups();
    const user = userEvent.setup();
    await pointAtRow(drawing, 0);
    expect(tooltip()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
  });

  it("keeps a dismissed tooltip hidden until the pointer actually moves", async () => {
    // Hiding a tooltip changes what is under a pointer that has not moved, and the browser then
    // reports the bar beneath it as entered, and may send a move to the same point. Neither is
    // the reader moving, so neither brings a tooltip back (WCAG 1.4.13): the dismissal ends on a
    // move to somewhere else.
    const { drawing } = await drawGroups();
    const user = userEvent.setup();
    const area = chart(/Use the arrow keys to read each bar/);
    await pointAtRow(drawing, 0);
    fireEvent.pointerMove(area, { clientX: 40, clientY: 20 });
    expect(tooltip()).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();

    // The tooltip gone, the engine reads the bar beneath a pointer that has not moved.
    await pointAtRow(drawing, 1);
    fireEvent.pointerMove(area, { clientX: 40, clientY: 20 });
    expect(tooltip()).toBeNull();

    fireEvent.pointerMove(area, { clientX: 40, clientY: 44 });
    expect(tooltip()).toHaveTextContent(/Draft/);
  });
});

describe("a chart over time, by pointer", () => {
  it("shows every series' value in the hovered interval", async () => {
    const { drawing } = await drawOverTime([
      line("Posts", [2, 9, 4]),
      line("Pages", [1, 5, 3]),
    ]);
    const user = userEvent.setup();
    await pointAtInterval(drawing, 1, 3);
    expect(tooltip()).toHaveTextContent(/Day 2/);
    expect(tooltip()).toHaveTextContent(/Posts\s*9/);
    expect(tooltip()).toHaveTextContent(/Pages\s*5/);
    // Each series' point in that interval is marked, not only the line's latest.
    expect(
      drawing.querySelectorAll(".chart-point-in-view circle")
    ).toHaveLength(2);
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
  });

  it("reads an interval a series has no point in as having none", async () => {
    await drawn(
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
    await drawOverTime([line("Posts", [2, 9, 4])]);
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
    await drawOverTime([line("Posts", [2, 9, 4]), line("Pages", [1, 5, 3])]);
    const user = userEvent.setup();
    await user.tab();
    expect(live()).toHaveTextContent("Posts, Day 3: 4.");
    await user.keyboard("{ArrowDown}");
    expect(live()).toHaveTextContent("Pages, Day 3: 3.");
  });
});

describe("the tooltip", () => {
  it("is drawn on the popover surface, with its mark's chart colour", async () => {
    await drawGroups();
    await userEvent.setup().tab();
    const tip = tooltip() as HTMLElement;
    expect(tip).toHaveClass("bg-popover");
    const swatch = within(tip).getByTestId("chart-tooltip-swatch");
    expect(swatch.style.backgroundColor).toBe("var(--nx-chart-3)");
  });
});

describe("a chart whose shape shrinks under it", () => {
  it("keeps the keyboard on the nearest point left, not on one that is gone", async () => {
    const { rerender } = await drawn(groupsTree());
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{End}");
    expect(live()).toHaveTextContent("Archived: 3.");
    // A smaller tier draws fewer bars; the reader who was at the end is still at the end.
    rerender(groupsTree(STATUSES.slice(0, 2)));
    expect(live()).toHaveTextContent("Draft: 57.");
    expect(tooltip()).toHaveTextContent(/Draft/);
  });

  it("forgets a hovered mark that is gone rather than showing another", async () => {
    const { rerender, drawing } = await drawn(groupsTree());
    await pointAtRow(drawing, 2);
    expect(tooltip()).toHaveTextContent(/Archived/);
    rerender(groupsTree(STATUSES.slice(0, 2)));
    expect(tooltip()).toBeNull();
    // Forgotten, not hidden: drawn with three bars again, the third shows no tooltip, since the
    // pointer is no longer over it.
    rerender(groupsTree());
    expect(tooltip()).toBeNull();
  });
});

describe("Escape for a hovered tooltip", () => {
  it("dismisses it while focus is in a text field", async () => {
    const { drawing } = await drawn(
      groupsTree(STATUSES, <input aria-label="Search" />)
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Search"));
    await pointAtRow(drawing, 0);
    expect(tooltip()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Search"));
    await user.keyboard("{Escape}");
    expect(tooltip()).toBeNull();
  });
});

describe("the tooltip's width", () => {
  it("is held to the chart's width, and wraps a long name", async () => {
    await drawGroups();
    await userEvent.setup().tab();
    expect(tooltip()).toHaveClass("w-max", "max-w-full", "break-words");
  });

  it("over time, is held to the chart's width the same way", async () => {
    await drawOverTime([line("Posts", [2, 9, 4])]);
    await userEvent.setup().tab();
    expect(tooltip()).toHaveClass("w-max", "max-w-full", "break-words");
  });
});

describe("what the live region reads for a bar", () => {
  it("names a group as the table speaks it, not as it is drawn", async () => {
    await drawn(
      groupsTree([
        {
          key: "null",
          value: null,
          label: "(none)",
          count: 9,
          announce: "no value stored",
        },
        group("draft", 2, "Draft"),
      ])
    );
    await userEvent.setup().tab();
    expect(live()).toHaveTextContent("no value stored: 9. 1 of 2.");
    expect(live()).not.toHaveTextContent("(none)");
  });

  it("is heard on every move, even between two bars that read alike", async () => {
    // Two stored values sharing one label and one count draw as two bars that look the same.
    await drawn(
      groupsTree([group("done", 4, "Done"), group("closed", 4, "Done")])
    );
    const user = userEvent.setup();
    await user.tab();
    const before = live().textContent;
    await user.keyboard("{ArrowDown}");
    expect(live().textContent).not.toBe(before);
    expect(live()).toHaveTextContent("Done: 4. 2 of 2.");
  });
});

describe("keys that belong to the browser", () => {
  it.each([
    ["Alt+ArrowLeft", { key: "ArrowLeft", altKey: true }],
    ["Ctrl+End", { key: "End", ctrlKey: true }],
    ["Meta+Home", { key: "Home", metaKey: true }],
  ])(
    "leaves %s to the browser: not taken, and the point does not move",
    async (_, key) => {
      await drawGroups();
      await userEvent.setup().tab();
      const before = live().textContent;
      const target = chart(/Use the arrow keys to read each bar/);

      // `fireEvent` answers whether the default went ahead: true means nothing prevented it.
      expect(fireEvent.keyDown(target, key)).toBe(true);
      expect(live().textContent).toBe(before);
    }
  );

  it("still moves on the same key held alone", async () => {
    await drawGroups();
    await userEvent.setup().tab();
    const target = chart(/Use the arrow keys to read each bar/);

    expect(fireEvent.keyDown(target, { key: "End" })).toBe(false);
    expect(live()).toHaveTextContent("Archived: 3. 3 of 3.");
  });
});

describe("one accessible object per chart", () => {
  it("names and describes the chart once, on the area a reader focuses, with no picture beside it", async () => {
    const { container } = await drawGroups();
    const area = chart(/Use the arrow keys to read each bar/);

    expect(area).toHaveAccessibleDescription(/Entries by status/);
    // The picture is drawn for sight only: nothing else in the chart is an image to a reader.
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("does the same for a chart over time", async () => {
    const { container } = await drawOverTime([line("Posts", [2, 9, 4])]);

    expect(
      chart(/Use the arrow keys to read each point/)
    ).toHaveAccessibleDescription(/Posts created/);
    expect(screen.queryByRole("img")).toBeNull();
    // No SVG title with words either, which a browser would show as a second hover tooltip.
    const titles = [...container.querySelectorAll("svg title")];
    expect(titles.map(title => title.textContent)).toEqual(
      titles.map(() => "")
    );
  });
});

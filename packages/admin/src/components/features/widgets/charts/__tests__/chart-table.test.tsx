/**
 * Every chart's numbers in a table that assistive tech can always reach: named by what the chart
 * shows, one row per value it draws, visually hidden, and never behind a disclosure, whose closed
 * state hides its table from assistive tech until someone opens it.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { GroupsChart } from "../groups-chart";
import { OverTimeChart } from "../over-time-chart";

import { sizeChartsInTests } from "./chart-env";

sizeChartsInTests();
afterEach(() => cleanup());

const charts: Array<[string, ReactNode, number]> = [
  [
    "a chart of groups",
    <GroupsChart
      key="g"
      title="Entries by status"
      labelHeading="Status"
      groups={[
        { key: "p", value: "published", label: "Published", count: 3 },
        { key: "d", value: "draft", label: "Draft", count: 2 },
      ]}
    />,
    2,
  ],
  [
    "a chart over time",
    <OverTimeChart
      key="o"
      title="Posts created"
      intervals={[
        { key: "d1", label: "Day 1" },
        { key: "d2", label: "Day 2" },
        { key: "d3", label: "Day 3" },
      ]}
      series={[
        {
          key: "posts",
          name: "Posts",
          points: [
            { key: "d1", value: 1 },
            { key: "d2", value: 4 },
            { key: "d3", value: 2 },
          ],
        },
      ]}
    />,
    3,
  ],
];

describe("a chart's table", () => {
  it.each(charts)(
    "of %s is in the accessibility tree, named by the chart, a row per value",
    async (_, chart, values) => {
      render(
        <CardTierContext.Provider value="medium">
          {chart}
        </CardTierContext.Provider>
      );
      await screen.findByTestId("chart-drawing");
      const table = screen.getByRole("table");
      expect(table).toHaveAccessibleName(/Entries by status|Posts created/);
      // The header row and one row per value the chart draws.
      expect(within(table).getAllByRole("row")).toHaveLength(values + 1);
    }
  );

  it.each(charts)(
    "of %s is visually hidden and inside no disclosure",
    async (_, chart) => {
      render(
        <CardTierContext.Provider value="medium">
          {chart}
        </CardTierContext.Provider>
      );
      await screen.findByTestId("chart-drawing");
      const table = screen.getByRole("table");
      expect(table.closest(".sr-only")).not.toBeNull();
      expect(table.closest("details")).toBeNull();
      expect(screen.queryByText("View as table")).toBeNull();
    }
  );
});

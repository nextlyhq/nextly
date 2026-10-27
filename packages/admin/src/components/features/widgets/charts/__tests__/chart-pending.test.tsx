/**
 * A chart before the chart engine arrives: it holds the height its marks will take, so nothing
 * below it moves when they do, and it can already be read -- its name, description and table are
 * drawn without the engine.
 *
 * The drawing modules are replaced by ones that never finish loading, so every test here sees the
 * chart as it is while the engine is on its way.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import {
  CHART_DATES_HEIGHT,
  CHART_PLOT_HEIGHT,
  CHART_ROW_HEIGHT,
} from "../chart-config";
import { GroupsChart } from "../groups-chart";
import { OverTimeChart } from "../over-time-chart";

/** A drawing that never finishes loading: it suspends on a promise that never settles. */
vi.mock("../drawn/over-time-drawing", () => ({
  default: () => {
    throw new Promise(() => undefined);
  },
}));
vi.mock("../drawn/groups-drawing", () => ({
  default: () => {
    throw new Promise(() => undefined);
  },
}));

afterEach(() => cleanup());

const POSTS = {
  key: "posts",
  name: "Posts",
  points: [
    { key: "d1", value: 2 },
    { key: "d2", value: 9 },
  ],
};
const DAYS = [
  { key: "d1", label: "Day 1" },
  { key: "d2", label: "Day 2" },
];

describe("a chart while the engine loads", () => {
  it.each([
    ["small", CHART_PLOT_HEIGHT],
    ["medium", CHART_PLOT_HEIGHT + CHART_DATES_HEIGHT],
  ] as const)("over time holds its marks' height at %s", (tier, height) => {
    render(
      <CardTierContext.Provider value={tier}>
        <OverTimeChart
          title="Posts created"
          intervals={DAYS}
          series={[POSTS]}
        />
      </CardTierContext.Provider>
    );
    expect(screen.getByTestId("chart-pending").style.height).toBe(
      `${height}px`
    );
    expect(screen.queryByTestId("chart-drawing")).toBeNull();
  });

  it("of groups holds one row's height for each group it will draw", () => {
    render(
      <CardTierContext.Provider value="medium">
        <GroupsChart
          title="By status"
          labelHeading="Status"
          groups={[
            { key: "a", value: "published", label: "Published", count: 3 },
            { key: "b", value: "draft", label: "Draft", count: 2 },
            { key: "c", value: "archived", label: "Archived", count: 1 },
          ]}
        />
      </CardTierContext.Provider>
    );
    expect(screen.getByTestId("chart-pending").style.height).toBe(
      `${3 * CHART_ROW_HEIGHT}px`
    );
  });

  it("can be read already: its name, description and table need no engine", () => {
    render(
      <CardTierContext.Provider value="medium">
        <OverTimeChart
          title="Posts created"
          intervals={DAYS}
          series={[POSTS]}
        />
      </CardTierContext.Provider>
    );
    const area = screen.getByRole("group", { name: /Posts created/ });
    expect(area).toHaveAccessibleDescription(/11 in total/);
    expect(
      screen.getByRole("table", { name: "Posts created" })
    ).toBeInTheDocument();
  });
});

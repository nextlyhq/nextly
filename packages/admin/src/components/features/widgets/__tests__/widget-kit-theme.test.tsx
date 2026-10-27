/**
 * The widget kit draws in the host's theme tokens and nothing else, so a
 * plugin's card matches core's beside it in light and dark: every state and
 * both charts, drawn in dark mode, name no colour of their own.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { GroupsChart } from "../charts/groups-chart";
import { OverTimeChart } from "../charts/over-time-chart";
import {
  CardEmpty,
  CardError,
  CardSkeleton,
  CardUnavailable,
} from "../frame/states";
import { CardTierContext } from "../frame/tier";

/** A colour written as a value rather than read from a theme token. */
const LITERAL_COLOUR =
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\[(?:#|rgb|hsl)/i;

/** The markup `node` draws inside a dark root, at a medium card's tier. */
function drawnDark(node: ReactNode): string {
  const { container } = render(
    <div className="dark">
      <CardTierContext.Provider value="medium">{node}</CardTierContext.Provider>
    </div>
  );
  return container.innerHTML;
}

const cases: Array<[string, ReactNode]> = [
  ["the skeleton", <CardSkeleton key="s" shape="bars" />],
  ["the empty state", <CardEmpty key="e" title="No orders yet" />],
  ["the unavailable state", <CardUnavailable key="u" />],
  [
    "the error state",
    <CardError
      key="x"
      title="Revenue"
      message="It failed."
      onRetry={() => {}}
    />,
  ],
  [
    "the groups chart",
    <GroupsChart
      key="g"
      title="Orders by state"
      labelHeading="State"
      groups={[
        { key: "open", label: "Open", count: 3, value: "open" },
        { key: "paid", label: "Paid", count: 5, value: "paid" },
      ]}
    />,
  ],
  [
    "the over-time chart",
    <OverTimeChart
      key="o"
      title="Orders"
      intervals={[
        { key: "a", label: "Mon" },
        { key: "b", label: "Tue" },
      ]}
      series={[
        {
          key: "orders",
          name: "Orders",
          points: [
            { key: "a", value: 1 },
            { key: "b", value: 2 },
          ],
        },
      ]}
    />,
  ],
];

describe("the widget kit in dark mode", () => {
  it.each(cases)("draws %s in theme tokens only", (_name, node) => {
    const html = drawnDark(node);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toMatch(LITERAL_COLOUR);
  });

  it("draws the charts' colours from the shared chart tokens", () => {
    // The positive half: a bar's colour is a token, so dark mode restyles it.
    expect(drawnDark(cases[4]![1])).toMatch(/var\(--nx-chart-\d\)/);
  });

  it("would catch a colour written as a value", () => {
    // The control: the check above is only evidence if it can fail.
    expect(drawnDark(<p style={{ color: "#ff0000" }}>x</p>)).toMatch(
      LITERAL_COLOUR
    );
  });
});

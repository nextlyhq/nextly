/**
 * The widget kit draws in the host's theme tokens and nothing else, so a
 * plugin's card matches core's beside it in light and dark: every part of
 * `Widget.*`, and the frame's states around them, drawn in dark mode, name no
 * colour of their own.
 */
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { sizeChartsInTests } from "../charts/__tests__/chart-env";
import {
  CardEmpty,
  CardError,
  CardSkeleton,
  CardUnavailable,
} from "../frame/states";
import { CardTierContext } from "../frame/tier";
import { Widget } from "../kit";

/** A colour written as a value rather than read from a theme token. */
const LITERAL_COLOUR =
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\[(?:#|rgb|hsl)/i;

// Sized, so a chart's engine draws its marks: the markup read is the drawing's own.
sizeChartsInTests();

/**
 * The markup `node` draws inside a dark root, at a medium card's tier, once any chart in it has
 * its drawing: before then a chart holds only its place, and a check of that passes for any
 * colours the drawing would use.
 */
async function drawnDark(
  node: ReactNode,
  tier: "medium" | "large" = "medium"
): Promise<string> {
  const { container } = render(
    <div className="dark">
      <CardTierContext.Provider value={tier}>{node}</CardTierContext.Provider>
    </div>
  );
  await waitFor(() =>
    expect(container.querySelector('[data-testid="chart-pending"]')).toBeNull()
  );
  return container.innerHTML;
}

/** Rows a list or table draws, as a widget's data would hand them. */
const ROWS = [
  // No "#" in the text: "#1001" reads as a hex colour to the check below.
  { id: "1", title: "Order 1001", customer: "Ada", state: "Paid" },
  { id: "2", title: "Order 1002", customer: "Grace", state: "Open" },
];

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
  ["Widget.Figure", <Widget.Figure key="f" value={1248} />],
  [
    "Widget.List, with a row's action",
    <Widget.List
      key="l"
      rows={ROWS}
      title={row => row.title}
      href={row => `/admin/collections/orders/${row.id}`}
      meta={row => [row.customer]}
      trailing={row => row.state}
      action={row => ({ label: "Open", href: `/orders/${row.id}` })}
      total={{ count: 12 }}
      viewAllHref="/admin/collections/orders"
    />,
  ],
  [
    "Widget.BarChart",
    <Widget.BarChart
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
    "Widget.SeriesChart",
    <Widget.SeriesChart
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
  it.each(cases)("draws %s in theme tokens only", async (_name, node) => {
    const html = await drawnDark(node);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toMatch(LITERAL_COLOUR);
  });

  it("draws Widget.Table as a table on a wide card, in theme tokens only", async () => {
    const html = await drawnDark(
      <Widget.Table
        rows={ROWS}
        titleLabel="Order"
        title={row => row.title}
        columns={[
          { key: "customer", label: "Customer", value: row => row.customer },
          {
            key: "state",
            label: "State",
            value: row => row.state,
            place: "trailing",
          },
        ]}
      />,
      "large"
    );
    // The table form itself, so the check reads its cells, not the rows a narrow card draws.
    expect(html).toContain("<table");
    expect(html).not.toMatch(LITERAL_COLOUR);
  });

  it("draws the charts' colours from the shared chart tokens", async () => {
    // The positive half: a bar's colour is a token, so dark mode restyles it.
    const html = await drawnDark(
      cases.find(([name]) => name === "Widget.BarChart")![1]
    );
    expect(html).toContain('data-testid="chart-drawing"');
    expect(html).toMatch(/var\(--nx-chart-\d\)/);
  });

  it("would catch a colour written as a value", async () => {
    // The control: the check above is only evidence if it can fail.
    expect(await drawnDark(<p style={{ color: "#ff0000" }}>x</p>)).toMatch(
      LITERAL_COLOUR
    );
  });
});

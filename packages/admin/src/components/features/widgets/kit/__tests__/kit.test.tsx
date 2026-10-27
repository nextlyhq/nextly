/**
 * The widget kit a widget's own view is drawn with: each part of `Widget` is the component core's
 * own cards use, a list or table draws the rows its card holds with one action each and no menu,
 * a list stays rows on a wide card while a table becomes a table, and the formatters and the
 * colour accessor answer as core's cards do.
 */
import { render, screen, within } from "@testing-library/react";
import type { SizeTier } from "@nextlyhq/ui/format";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { GroupsChart } from "../../charts/groups-chart";
import { OverTimeChart } from "../../charts/over-time-chart";
import { CardFigure } from "../../frame/figure";
import { cardChange, cardNumber } from "../../frame/format";
import { CardTierContext, rowsDrawn } from "../../frame/tier";
import {
  formatWidgetChange,
  formatWidgetNumber,
  Widget,
  widgetChartColour,
} from "..";

interface Order {
  id: string;
  title: string;
  customer: string;
  state: string;
}

const orders: Order[] = Array.from({ length: 12 }, (_, index) => ({
  id: String(index + 1),
  title: `Order #${1001 + index}`,
  customer: `Customer ${index + 1}`,
  state: index % 2 === 0 ? "Paid" : "Open",
}));

const atTier = (tier: SizeTier, node: ReactNode) =>
  render(
    <CardTierContext.Provider value={tier}>{node}</CardTierContext.Provider>
  );

const list = (
  <Widget.List
    rows={orders}
    title={row => row.title}
    href={row => `/admin/collections/orders/${row.id}`}
    meta={row => [row.customer]}
    trailing={row => row.state}
    action={row => ({ label: "Refund", href: `/refunds/new?order=${row.id}` })}
    total={{ count: 12 }}
    viewAllHref="/admin/collections/orders"
  />
);

const table = (
  <Widget.Table
    rows={orders}
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
  />
);

describe("the parts of Widget", () => {
  it("is exactly the five parts, each the component core's own cards use", () => {
    expect(Object.keys(Widget).sort()).toEqual([
      "BarChart",
      "Figure",
      "List",
      "SeriesChart",
      "Table",
    ]);
    expect(Widget.Figure).toBe(CardFigure);
    expect(Widget.BarChart).toBe(GroupsChart);
    expect(Widget.SeriesChart).toBe(OverTimeChart);
    expect(Object.isFrozen(Widget)).toBe(true);
  });
});

describe("Widget.List", () => {
  it("draws the rows its card holds, and says how many there are in all", () => {
    atTier("small", list);
    const rows = screen.getAllByTestId("entity-row");
    // Counted by the rule core's list cards are counted by, at this card's size.
    expect(rows).toHaveLength(rowsDrawn("small", undefined));
    expect(rows.length).toBeLessThan(orders.length);
    expect(screen.getByRole("link", { name: /View all/ })).toHaveAttribute(
      "href",
      "/admin/collections/orders"
    );
  });

  it("draws more rows on a larger card", () => {
    atTier("large", list);
    expect(screen.getAllByTestId("entity-row")).toHaveLength(
      rowsDrawn("large", undefined)
    );
  });

  it("gives each row its one action as a link, and no menu", () => {
    atTier("medium", list);
    const [first] = screen.getAllByTestId("entity-row");
    const row = within(first!);
    expect(row.getByRole("link", { name: "Refund" })).toHaveAttribute(
      "href",
      "/refunds/new?order=1"
    );
    expect(row.queryByRole("button", { name: /Actions for/ })).toBeNull();
    expect(row.getByTestId("entity-row-meta")).toHaveTextContent("Customer 1");
    expect(row.getByTestId("entity-row-trailing")).toHaveTextContent("Paid");
  });

  it("stays rows on a wide card, where a table is Widget.Table", () => {
    const { container } = atTier("large", list);
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getAllByTestId("entity-row").length).toBeGreaterThan(0);
  });
});

describe("Widget.Table", () => {
  it("is a table of its columns on a wide card", () => {
    const { container } = atTier("large", table);
    const grid = container.querySelector("table");
    expect(grid).not.toBeNull();
    expect(
      within(grid!).getByRole("columnheader", { name: "Customer" })
    ).toBeTruthy();
    expect(
      within(grid!).getByRole("columnheader", { name: "State" })
    ).toBeTruthy();
  });

  it("is rows on a narrow card, its columns under each title and at its end", () => {
    const { container } = atTier("small", table);
    expect(container.querySelector("table")).toBeNull();
    const [first] = screen.getAllByTestId("entity-row");
    expect(within(first!).getByTestId("entity-row-trailing")).toHaveTextContent(
      "Paid"
    );
  });
});

describe("the formatters and the colour accessor", () => {
  it("are core's own formatters", () => {
    expect(formatWidgetNumber).toBe(cardNumber);
    expect(formatWidgetChange).toBe(cardChange);
    expect(formatWidgetNumber(2000, { floor: true }).text).toBe("2,000+");
  });

  it("names a slot's colour as its theme token", () => {
    expect(widgetChartColour(1)).toBe("var(--nx-chart-1)");
    expect(widgetChartColour(5)).toBe("var(--nx-chart-5)");
  });
});

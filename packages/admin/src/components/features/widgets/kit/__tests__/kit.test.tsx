/**
 * The widget kit a widget's own view is drawn with: each part of `Widget` is the component core's
 * own cards use, a list or table draws the rows its card holds with one action each and no menu,
 * a list stays rows on a wide card while a table becomes a table, a table holds at most three
 * columns beside its title, an unlinked row is heard by its spoken form, and the rows drawn stop
 * at the query's limit.
 */
import { render, screen, within } from "@testing-library/react";
import type { SizeTier } from "@nextlyhq/ui/format";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { GroupsChart } from "../../charts/groups-chart";
import { OverTimeChart } from "../../charts/over-time-chart";
import { CardFigure } from "../../frame/figure";
import { CARD_FOOTER_LINK_CLASS } from "../../frame/footer-slot";
import { CardTierContext, rowsDrawn } from "../../frame/tier";
import { WidgetCard } from "../../WidgetCard";
import { Widget } from "..";
import { WidgetFooterLink } from "../footer-link";

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
  it("is exactly the six parts, each the component core's own cards use", () => {
    expect(Object.keys(Widget).sort()).toEqual([
      "BarChart",
      "Figure",
      "FooterLink",
      "List",
      "SeriesChart",
      "Table",
    ]);
    expect(Widget.Figure).toBe(CardFigure);
    expect(Widget.FooterLink).toBe(WidgetFooterLink);
    expect(Widget.BarChart).toBe(GroupsChart);
    expect(Widget.SeriesChart).toBe(OverTimeChart);
    expect(Object.isFrozen(Widget)).toBe(true);
  });
});

describe("Widget.FooterLink", () => {
  it("draws its link in the card's own footer, never in the body", () => {
    render(
      <WidgetCard title="Orders">
        <p>12 orders</p>
        <Widget.FooterLink
          href="/admin/collections/orders"
          label="All orders"
        />
      </WidgetCard>
    );
    const footer = screen.getByTestId("widget-card-footer");
    const link = within(footer).getByRole("link", { name: "All orders" });
    expect(link).toHaveAttribute("href", "/admin/collections/orders");
    // Styled as every card's footer link is.
    expect(link).toHaveClass(...CARD_FOOTER_LINK_CLASS.split(" "));
    expect(
      within(screen.getByTestId("widget-card-body")).queryByRole("link")
    ).toBeNull();
  });

  it("takes the place of the widget's own link, so the footer holds one link", () => {
    render(
      <WidgetCard
        title="Orders"
        link={{ label: "Open orders", href: "/orders" }}
      >
        <Widget.FooterLink
          href="/admin/collections/orders"
          label="All orders"
        />
      </WidgetCard>
    );
    const footer = screen.getByTestId("widget-card-footer");
    expect(within(footer).getAllByRole("link")).toHaveLength(1);
    expect(within(footer).getByRole("link")).toHaveTextContent("All orders");
  });

  it("is the one link drawn beside a list's View all, wherever it stands", () => {
    // 🔴 A single claim: the explicit link outranks the list's "View all", which the footer would
    // otherwise draw beside it. Both orders, so the rank decides and not who drew first.
    const card = (body: ReactNode) => (
      <WidgetCard title="Orders" h={4}>
        {body}
      </WidgetCard>
    );
    const footerLink = (
      <Widget.FooterLink href="/admin/collections/orders" label="All orders" />
    );
    const viewAll = (
      <Widget.List
        rows={orders}
        title={row => row.title}
        total={{ count: 12 }}
        viewAllHref="/admin/collections/orders?view=all"
      />
    );
    for (const body of [
      [footerLink, viewAll],
      [viewAll, footerLink],
    ]) {
      const { unmount } = render(card(<>{body}</>));
      const footer = screen.getByTestId("widget-card-footer");
      expect(within(footer).getAllByRole("link")).toHaveLength(1);
      expect(within(footer).getByRole("link")).toHaveTextContent("All orders");
      unmount();
    }
  });

  it("draws one of two FooterLinks, and tells the widget's author once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <WidgetCard title="Orders" widgetId="acme/orders">
          <Widget.FooterLink href="/a" label="First" />
          <Widget.FooterLink href="/b" label="Second" />
        </WidgetCard>
      );
      const footer = screen.getByTestId("widget-card-footer");
      expect(within(footer).getAllByRole("link")).toHaveLength(1);
      expect(within(footer).getByRole("link")).toHaveTextContent("Second");
      const told = warn.mock.calls.filter(([message]) =>
        String(message).includes("Widget.FooterLink")
      );
      expect(told).toHaveLength(1);
      expect(String(told[0]?.[0])).toContain('"acme/orders"');
    } finally {
      warn.mockRestore();
    }
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

describe("Widget.Table's columns", () => {
  it("are at most three beside the title: a fourth from an unchecked caller is not drawn at any size, and the console says so once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const four = [
      { key: "a", label: "A", value: (row: Order) => row.customer },
      { key: "b", label: "B", value: (row: Order) => row.state },
      { key: "c", label: "C", value: (row: Order) => row.id },
      { key: "d", label: "D", value: (row: Order) => row.title },
    ] as unknown as readonly [];
    const wide = atTier(
      "large",
      <Widget.Table
        rows={orders}
        titleLabel="Order"
        title={row => row.title}
        columns={four}
      />
    );
    const headings = within(wide.container.querySelector("table")!)
      .getAllByRole("columnheader")
      .map(heading => heading.textContent);
    expect(headings).toEqual(["Order", "A", "B", "C"]);
    wide.unmount();
    atTier(
      "large",
      <Widget.Table
        rows={orders}
        titleLabel="Order"
        title={row => row.title}
        columns={four}
      />
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("at most 3 columns");
    warn.mockRestore();
  });
});

describe("a row with nowhere to go", () => {
  it("is heard by its spoken form in the table, as it is in a row", () => {
    const { container } = atTier(
      "large",
      <Widget.Table
        rows={orders.slice(0, 1)}
        titleLabel="Order"
        title={row => row.title}
        spoken={row => `Order ${row.id}, ${row.state}`}
        columns={[{ key: "state", label: "State", value: row => row.state }]}
      />
    );
    const cell = within(container.querySelector("table")!).getAllByRole(
      "cell"
    )[0]!;
    expect(within(cell).getByText("Order 1, Paid")).toHaveClass("sr-only");
    expect(
      within(cell).getByText("Order #1001").closest("[aria-hidden='true']")
    ).not.toBeNull();
  });
});

describe("the rows drawn", () => {
  it("stop at the query's limit, so a sized query's extra row only says more exist", () => {
    atTier(
      "large",
      <Widget.List
        rows={orders.slice(0, 3)}
        title={row => row.title}
        limit={2}
        viewAllHref="/admin/collections/orders"
      />
    );
    expect(screen.getAllByTestId("entity-row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /View all/ })).toHaveTextContent(
      "View all (3+)"
    );
  });
});

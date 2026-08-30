/**
 * The renderer's job is dispatch: the right body inside the one card, and a
 * refusal rather than a coercion when the payload is not what the archetype
 * asked for.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { WidgetRenderer } from "../WidgetRenderer";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

const metric: DashboardWidget = {
  id: "core/published-posts",
  title: "Published posts",
  archetype: "metric",
  size: "sm",
  query: { source: "collection:posts", op: "count" },
};

const countSlot = (total: number): WidgetSlot => ({
  ok: true,
  result: { op: "count", total },
});

describe("WidgetRenderer — metric", () => {
  it("renders a count, formatted for the reader's locale", () => {
    render(<WidgetRenderer definition={metric} slot={countSlot(1234567)} />);
    expect(screen.getByTestId("widget-metric-value")).toHaveTextContent(
      (1234567).toLocaleString()
    );
  });

  it("renders zero as zero rather than as an empty state", () => {
    render(<WidgetRenderer definition={metric} slot={countSlot(0)} />);
    expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("0");
  });

  it("wears the shared card anatomy, title and all", () => {
    render(<WidgetRenderer definition={metric} slot={countSlot(5)} />);
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.getByTestId("widget-card-body")).toBeInTheDocument();
  });

  it("marks the body busy while the batch has not answered for it", () => {
    render(<WidgetRenderer definition={metric} slot={undefined} />);
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
  });

  it("says a list payload is the wrong shape rather than coercing it", () => {
    render(
      <WidgetRenderer
        definition={metric}
        slot={{ ok: true, result: { op: "list", items: [{ id: 1 }] } }}
      />
    );
    // Not "1" (the item count), and not blank.
    expect(screen.queryByTestId("widget-metric-value")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/expected a count/i);
    // The title survives, so the user knows which widget is mismatched.
    expect(screen.getByText("Published posts")).toBeInTheDocument();
  });

  it("shows a failed slot's message and keeps the title", () => {
    render(
      <WidgetRenderer
        definition={metric}
        slot={{ ok: false, error: "Source unavailable." }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable.");
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-metric-value")).not.toBeInTheDocument();
  });

  it("renders the definition's single footer link", () => {
    render(
      <WidgetRenderer
        definition={{
          ...metric,
          link: { label: "View all", href: "/dashboard/entries/posts" },
        }}
        slot={countSlot(3)}
      />
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/dashboard/entries/posts");
  });
});

describe("WidgetRenderer — custom", () => {
  const custom: DashboardWidget = {
    id: "acme/panel",
    title: "Acme panel",
    archetype: "custom",
    size: "lg",
    component: "@acme/admin#Panel",
  };

  it("renders the plugin component through the existing PluginSlot", () => {
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(<WidgetRenderer definition={custom} slot={undefined} />);
    expect(screen.getByText("acme body")).toBeInTheDocument();
    expect(screen.getByText("Acme panel")).toBeInTheDocument();
  });

  it("isolates a throwing plugin component behind the boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerComponent("@acme/admin#Panel", () => {
      throw new Error("boom");
    });
    render(<WidgetRenderer definition={custom} slot={undefined} />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    // The rest of the card is intact around the isolated body.
    expect(screen.getByText("Acme panel")).toBeInTheDocument();
  });

  it("never marks a custom body busy for a batch it did not participate in", () => {
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(<WidgetRenderer definition={custom} slot={undefined} />);
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );
  });
});

describe("WidgetRenderer — archetypes not built yet", () => {
  it("says so, by name, instead of rendering an empty card", () => {
    render(
      <WidgetRenderer
        definition={{
          id: "core/recent",
          title: "Recent entries",
          archetype: "list",
          size: "lg",
          query: { source: "collection:posts", op: "list" },
        }}
        slot={{ ok: true, result: { op: "list", items: [] } }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/list/i);
    expect(screen.getByText("Recent entries")).toBeInTheDocument();
  });
});

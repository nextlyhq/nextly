/**
 * What an `actions` card shows, and what it refuses to advertise.
 *
 * The permission cases matter most. Per-item gating happens in
 * `resolve-widgets`, so by the time a body sees a widget the list is already
 * the reader's — these assert what the body does with what it is handed, and
 * the resolver's own tests assert the filtering.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { actionsAccepts, actionsBody } from "../actions";

vi.mock("@admin/components/ui/link", () => ({
  Link: ({ children, ...rest }: Record<string, unknown>) => (
    <a {...(rest as Record<string, string>)}>{children as never}</a>
  ),
}));

const widget = (
  actions?: { label: string; href: string; external?: boolean }[]
): DashboardWidget =>
  ({
    id: "core/shortcuts",
    title: "Shortcuts",
    archetype: "actions",
    size: "sm",
    ...(actions && { actions }),
  }) as DashboardWidget;

function draw(definition: DashboardWidget) {
  const outcome = actionsBody(definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  render(<>{outcome.node}</>);
}

describe("the actions archetype", () => {
  it("draws one link per shortcut, in declaration order", () => {
    draw(
      widget([
        { label: "New post", href: "/admin/posts/new" },
        { label: "Invite user", href: "/admin/users/new" },
      ])
    );
    const links = screen.getAllByTestId("widget-action");
    expect(links.map(l => l.textContent)).toEqual(["New post", "Invite user"]);
    expect(links[0]).toHaveAttribute("href", "/admin/posts/new");
  });

  it("opens an external destination in a new tab, and says so", () => {
    draw(
      widget([
        { label: "Docs", href: "https://nextly.dev/docs", external: true },
      ])
    );
    const link = screen.getByTestId("widget-action");
    expect(link).toHaveAttribute("target", "_blank");
    // `noopener` so the opened page cannot reach back into this window.
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveTextContent(/opens in a new tab/i);
  });

  it("leaves an internal link in this tab", () => {
    // The control: without it, an implementation that marked EVERYTHING
    // external would satisfy the case above.
    draw(widget([{ label: "New post", href: "/admin/posts/new" }]));
    expect(screen.getByTestId("widget-action")).not.toHaveAttribute("target");
  });

  it("caps the shortcuts it draws and COUNTS the rest", () => {
    // Silently dropping them would read as the whole list, and the author has
    // no way to notice their tenth shortcut never appeared.
    const many = Array.from({ length: 9 }, (_, i) => ({
      label: `Action ${i}`,
      href: `/admin/${i}`,
    }));
    draw(widget(many));
    expect(screen.getAllByTestId("widget-action")).toHaveLength(6);
    expect(screen.getByTestId("widget-actions-overflow")).toHaveTextContent(
      "3 more not shown."
    );
  });

  it("says nothing is left when the reader may use none of them", () => {
    // The widget is legitimately present -- its own permission let it through
    // -- so saying so beats a titled card with nothing under it.
    draw(widget([]));
    expect(screen.getByTestId("widget-actions-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-action")).not.toBeInTheDocument();
  });

  it("does not count an overflow that is not there", () => {
    draw(widget([{ label: "New post", href: "/admin/posts/new" }]));
    expect(
      screen.queryByTestId("widget-actions-overflow")
    ).not.toBeInTheDocument();
  });

  it("refuses a declaration carrying no shortcuts at all", () => {
    expect(actionsAccepts(widget())).toMatch(/declares no shortcuts/i);
    expect(
      actionsAccepts(widget([{ label: "New post", href: "/x" }]))
    ).toBeUndefined();
  });
});

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
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      /expected a count/i
    );
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
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "Source unavailable."
    );
    expect(screen.getByText("Published posts")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-metric-value")).not.toBeInTheDocument();
  });

  it("says it is busy during a refetch WITHOUT discarding the number on screen", () => {
    // The card marks the body rather than swapping in a spinner, so the reader
    // keeps the value while a screen reader is told the dashboard is reading
    // again. Reporting only the first load left `aria-busy` false for every
    // window-focus refresh this grid performs.
    render(
      <WidgetRenderer definition={metric} slot={countSlot(21)} isFetching />
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("21");
  });

  it("is not busy once a refetch has settled", () => {
    render(<WidgetRenderer definition={metric} slot={countSlot(21)} />);
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );
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

describe("WidgetRenderer — an archetype named off Object.prototype", () => {
  // Boot accepts an archetype this release does not know, so one unknown card
  // cannot abort the install. That makes the archetype an arbitrary string from
  // a plugin, and a plain-object renderer table answers for every name on
  // `Object.prototype` as well as its own.
  const inherited: DashboardWidget = {
    id: "acme/evil",
    title: "Evil",
    archetype: "__proto__" as DashboardWidget["archetype"],
    size: "sm",
    query: { source: "collection:posts", op: "count" },
  };

  it("does not mistake `__proto__` for a renderer", () => {
    // `ARCHETYPE_BODIES["__proto__"]` is an object, so the renderer looked
    // present and `body(...)` threw "body is not a function" -- out of the card
    // and into the dashboard's error boundary, taking every other widget with
    // it, because nothing wraps a widget individually.
    render(<WidgetRenderer definition={inherited} slot={countSlot(1)} />);
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      /not rendered yet/i
    );
  });

  it("does not CALL an inherited function like `constructor`", () => {
    // The quieter half, and the reason `Object.hasOwn` rather than a typeof
    // check: `constructor`, `toString` and `valueOf` ARE functions. They were
    // invoked with a widget result and returned something whose `ok` is
    // `undefined`, drawing a blank error with no sentence on it.
    render(
      <WidgetRenderer
        definition={{
          ...inherited,
          archetype: "constructor" as DashboardWidget["archetype"],
        }}
        slot={countSlot(1)}
      />
    );
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      /not rendered yet/i
    );
  });

  it("still draws the archetype it DOES own", () => {
    // The positive control. A lookup that refused everything would satisfy both
    // assertions above while rendering nothing at all.
    render(
      <WidgetRenderer
        definition={{ ...inherited, archetype: "metric" }}
        slot={countSlot(7)}
      />
    );
    expect(screen.getByTestId("widget-metric-value")).toHaveTextContent("7");
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

  it("hands the plugin component the slot the batch fetched for it", () => {
    // A `custom` widget may declare a query -- core's validator allows it
    // deliberately -- and the grid puts that query in the batch. Withholding
    // the answer here made the dashboard pay for the read and then throw it
    // away, on every mount and every window focus.
    registerComponent(
      "@acme/admin#Panel",
      ({ slot }: { slot?: WidgetSlot }) => (
        <div>
          {slot?.ok === true && slot.result.op === "count"
            ? `count:${slot.result.total}`
            : "no slot"}
        </div>
      )
    );
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={countSlot(7)}
      />
    );
    expect(screen.getByText("count:7")).toBeInTheDocument();
  });

  it("marks a QUERIED custom card busy during a background refetch", () => {
    // The card keeps the plugin's body through a window-focus refetch, exactly
    // as an archetype keeps its number, so the only thing telling a screen
    // reader the dashboard is reading again is `aria-busy`. This branch drew
    // the card without it while every other branch reported it.
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={countSlot(7)}
        isFetching
      />
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    // Marked busy, not replaced: the body the plugin drew is still there.
    expect(screen.getByText("acme body")).toBeInTheDocument();
  });

  it("tells the plugin component a refetch is in flight", () => {
    // The slot alone cannot say it. During a refetch the slot still holds the
    // PREVIOUS answer, which is byte-for-byte what idle looks like, so a
    // component wanting to dim its own body had nothing to read.
    registerComponent(
      "@acme/admin#Panel",
      ({ isFetching }: { isFetching?: boolean }) => (
        <div>{isFetching ? "refreshing" : "idle"}</div>
      )
    );
    const definition = {
      ...custom,
      query: { source: "collection:posts", op: "count" } as const,
    };

    const { rerender } = render(
      <WidgetRenderer definition={definition} slot={countSlot(7)} isFetching />
    );
    expect(screen.getByText("refreshing")).toBeInTheDocument();

    rerender(
      <WidgetRenderer
        definition={definition}
        slot={countSlot(7)}
        isFetching={false}
      />
    );
    // Both directions, so the assertion cannot be satisfied by a component that
    // simply always renders "refreshing".
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows a queried custom card when its data landed", () => {
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={countSlot(7)}
        updatedAt={new Date()}
      />
    );
    expect(screen.getByTestId("widget-card-freshness")).toBeInTheDocument();
  });

  it("claims no freshness on a custom card whose slot was refused", () => {
    // A self-drawn body is never REPLACED by an error, so the card's own
    // `settled` gate -- which withholds the footer when `error` is set -- never
    // fires for it. Without this the card printed "Updated just now" under a
    // body the component drew from a failure.
    registerComponent("@acme/admin#Panel", () => <div>could not load</div>);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={{ ok: false, error: "Source unavailable." }}
        updatedAt={new Date()}
      />
    );
    expect(
      screen.queryByTestId("widget-card-freshness")
    ).not.toBeInTheDocument();
    // The plugin's own body still stands: a refusal is its to draw, not ours.
    expect(screen.getByText("could not load")).toBeInTheDocument();
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

describe("WidgetRenderer — freshness", () => {
  it("shows when the data landed on a card that has data", () => {
    render(
      <WidgetRenderer
        definition={metric}
        slot={countSlot(3)}
        updatedAt={new Date()}
      />
    );
    expect(screen.getByTestId("widget-card-freshness")).toHaveTextContent(
      /updated just now/i
    );
  });

  it("says nothing about freshness on a slot that failed", () => {
    render(
      <WidgetRenderer
        definition={metric}
        slot={{ ok: false, error: "Source unavailable." }}
        updatedAt={new Date()}
      />
    );
    expect(
      screen.queryByTestId("widget-card-freshness")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "Source unavailable."
    );
  });
});

describe("WidgetRenderer — a data archetype with nothing to draw from", () => {
  it("says so rather than staying busy for a slot that will never arrive", () => {
    render(
      <WidgetRenderer
        definition={{
          id: "acme/queryless",
          title: "Queryless",
          archetype: "metric",
          size: "sm",
        }}
        slot={undefined}
      />
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      /declares none/i
    );
    expect(screen.getByText("Queryless")).toBeInTheDocument();
  });

  it("stays busy for a widget that DID ask and has not been answered", () => {
    // The control for the case above: absence still means in flight when there
    // is a request to be in flight.
    render(<WidgetRenderer definition={metric} slot={undefined} />);
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.queryByTestId("widget-card-error")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(/list/i);
    expect(screen.getByText("Recent entries")).toBeInTheDocument();
  });
});

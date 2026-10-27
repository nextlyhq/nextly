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

describe("WidgetRenderer — an archetype drawn without data", () => {
  // `text` and `actions` are queryless by core's contract -- the registry
  // validator refuses a query on them -- so they never enter the batch and no
  // slot ever arrives. The outcome resolver used to read that absence as
  // "drawn from a query, and this widget declares none", which would have made
  // the FIRST body registered for one fail on every render, permanently.
  const shortcuts: DashboardWidget = {
    id: "core/shortcuts",
    title: "Shortcuts",
    archetype: "actions",
    size: "sm",
    actions: [{ label: "New post", href: "/admin/posts/new" }],
  };

  it("draws with NO slot, rather than reporting a missing query", () => {
    render(<WidgetRenderer definition={shortcuts} slot={undefined} />);
    expect(screen.getByTestId("widget-action")).toHaveTextContent("New post");
    expect(screen.queryByTestId("widget-card-error")).not.toBeInTheDocument();
  });

  it("never waits on a request that is not coming", () => {
    // The other half: absent must not read as "in flight" either, or the card
    // sits loading for the life of the page with nothing saying why.
    render(<WidgetRenderer definition={shortcuts} slot={undefined} />);
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "false"
    );
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

  /*
   * 🔴 A plugin's component is the ONLY thing that can consume a `text`,
   * `checkbox` or `select` setting -- core reads just the `limit` query knob.
   * `plugin-sdk` is an author's only stable import surface, so a value it
   * cannot receive as a prop it cannot observe at all: a reader could choose
   * one and the card drawing it would never learn of it.
   *
   * The placement id travels with them because `widgetId` does not identify a
   * card. The same widget can sit on a dashboard twice with different
   * settings, and a component keying local state or a fetch on the widget id
   * would have the two copies overwrite each other -- the defect the batch
   * already had, one layer along.
   */
  it("hands the plugin component its placement and resolved settings", () => {
    registerComponent(
      "@acme/admin#Panel",
      ({
        placementId,
        settings,
      }: {
        placementId?: string;
        settings?: Record<string, unknown>;
      }) => <div>{`${placementId}:${JSON.stringify(settings)}`}</div>
    );
    render(
      <WidgetRenderer
        definition={custom}
        slot={undefined}
        placement={{ id: "p-2", settings: { mode: "grid" } }}
      />
    );
    expect(screen.getByText('p-2:{"mode":"grid"}')).toBeInTheDocument();
  });

  it("falls back to the widget id when rendered outside an arrangement", () => {
    // The layout's own rule rather than a guess: `defaultPlacements` names each
    // placement after its widget, because an unarranged dashboard is the one
    // case where the two are genuinely one-to-one.
    registerComponent(
      "@acme/admin#Panel",
      ({
        placementId,
        settings,
      }: {
        placementId?: string;
        settings?: Record<string, unknown>;
      }) => <div>{`${placementId}:${JSON.stringify(settings)}`}</div>
    );
    render(<WidgetRenderer definition={custom} slot={undefined} />);
    expect(screen.getByText("acme/panel:{}")).toBeInTheDocument();
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

  it("hands the plugin component the query it asked, and none to a card that asked nothing", () => {
    // The query as asked, its reader's "Number of items" in it, is what lets a
    // custom card draw the rows core's lists draw and know the extra row the
    // batch asked for means more exist.
    registerComponent(
      "@acme/admin#Panel",
      ({ query }: { query?: { source: string; limit?: number } }) => (
        <div>{query ? `${query.source}:${query.limit}` : "no query"}</div>
      )
    );
    const { unmount } = render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "system:activity", op: "list", limit: 8 },
        }}
        slot={undefined}
      />
    );
    expect(screen.getByText("system:activity:8")).toBeInTheDocument();
    unmount();

    render(<WidgetRenderer definition={custom} slot={undefined} />);
    expect(screen.getByText("no query")).toBeInTheDocument();
  });

  it("hands the plugin component the card's Retry, for an error its own data reports", () => {
    // A failed answer is the frame's, with the frame's Retry; an error the
    // component reads from a good answer it reports, and the Retry it offers
    // there is the same callback.
    const onRetry = vi.fn();
    registerComponent(
      "@acme/admin#Panel",
      ({ onRetry: retry }: { onRetry?: () => void }) =>
        retry ? (
          <button type="button" onClick={retry}>
            again
          </button>
        ) : (
          <div>no retry</div>
        )
    );
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={countSlot(1)}
        onRetry={onRetry}
      />
    );
    screen.getByRole("button", { name: "again" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers the frame's Retry on a custom card whose answer failed", () => {
    const onRetry = vi.fn();
    registerComponent("@acme/admin#Panel", () => <div>never drawn</div>);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={{ ok: false, error: "down" }}
        onRetry={onRetry}
      />
    );
    screen.getByRole("button", { name: /^Retry/ }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("never drawn")).toBeNull();
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

  it("shows a queried custom card's own body when its data landed", () => {
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={countSlot(7)}
      />
    );
    expect(screen.getByText("acme body")).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("data-state", "ready");
  });

  it("draws a custom card's refused slot in the frame, and never reaches its component", () => {
    // A failed answer is the frame's to draw, as for any card: the component
    // used to be handed it and draw a state of its own inside a card that
    // still said it was ready.
    const component = vi.fn(() => <div>could not load</div>);
    registerComponent("@acme/admin#Panel", component);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={{ ok: false, error: "Source unavailable." }}
        onRetry={() => {}}
      />
    );
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      "Source unavailable."
    );
    expect(screen.getByRole("region")).toHaveAttribute("data-state", "error");
    expect(component).not.toHaveBeenCalled();
    expect(screen.queryByText("could not load")).not.toBeInTheDocument();
  });

  it("draws a custom card's unavailable slot as the one no-access state", () => {
    const component = vi.fn(() => <div>acme body</div>);
    registerComponent("@acme/admin#Panel", component);
    render(
      <WidgetRenderer
        definition={{
          ...custom,
          query: { source: "collection:posts", op: "count" },
        }}
        slot={{ ok: false, error: "Not available.", code: "unavailable" }}
      />
    );
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    expect(component).not.toHaveBeenCalled();
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
  it("says nothing about when the data landed, on a card with data or a failed one", () => {
    for (const slot of [
      countSlot(3),
      { ok: false as const, error: "Source unavailable." },
    ]) {
      const { container, unmount } = render(
        <WidgetRenderer definition={metric} slot={slot} />
      );
      expect(container.querySelector("time")).toBeNull();
      expect(container.textContent).not.toMatch(/updated/i);
      unmount();
    }
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

describe("WidgetRenderer — every card is framed", () => {
  it("frames a custom widget's own component, under the card's one title", () => {
    // No widget declines the frame: the frame draws the header and every state,
    // and a component draws only its body.
    registerComponent("@t/x#Body", () => <p>body</p>);
    render(
      <WidgetRenderer
        definition={{
          id: "acme/team",
          title: "Team",
          archetype: "custom",
          size: "lg",
          component: "@t/x#Body",
        }}
        slot={undefined}
      />
    );
    expect(screen.getByTestId("widget-card-body")).toHaveTextContent("body");
    expect(screen.getAllByRole("heading", { name: "Team" })).toHaveLength(1);
  });
});

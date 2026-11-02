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

import { gridBounds } from "./grid-bounds";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

const metric: DashboardWidget = {
  id: "core/published-posts",
  title: "Published posts",
  archetype: "metric",
  size: gridBounds(3),
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
    size: gridBounds(3),
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
    size: gridBounds(6),
    component: "@acme/admin#Panel",
  };

  it("offers the frame's Retry on a custom card whose answer failed", () => {
    const onRetry = vi.fn();
    registerComponent("@acme/admin#Panel", () => <div>never drawn</div>);
    render(
      <WidgetRenderer
        definition={custom}
        slot={{ ok: false, error: "down" }}
        onRetry={onRetry}
      />
    );
    screen.getByRole("button", { name: /^Retry/ }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("never drawn")).toBeNull();
  });

  it("marks a custom card busy during a background refetch", () => {
    // The card keeps the plugin's body through a window-focus refetch, exactly
    // as an archetype keeps its number, so the only thing telling a screen
    // reader the dashboard is reading again is `aria-busy`. This branch drew
    // the card without it while every other branch reported it.
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(
      <WidgetRenderer definition={custom} slot={countSlot(7)} isFetching />
    );
    expect(screen.getByTestId("widget-card-body")).toHaveAttribute(
      "aria-busy",
      "true"
    );
    // Marked busy, not replaced: the body the plugin drew is still there.
    expect(screen.getByText("acme body")).toBeInTheDocument();
  });

  it("shows a custom card's own body when its data landed", () => {
    registerComponent("@acme/admin#Panel", () => <div>acme body</div>);
    render(<WidgetRenderer definition={custom} slot={countSlot(7)} />);
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
        definition={custom}
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
        definition={custom}
        slot={{ ok: false, error: "Not available.", code: "unavailable" }}
      />
    );
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    expect(component).not.toHaveBeenCalled();
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

describe("WidgetRenderer — a card whose answer is on its way", () => {
  it("stays busy while its answer has not arrived", () => {
    // Every card is asked for by its id, so an absent answer is one in flight.
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
          id: "acme/gauge",
          title: "Load gauge",
          archetype: "gauge" as DashboardWidget["archetype"],
          size: gridBounds(6),
        }}
        slot={countSlot(3)}
      />
    );
    expect(screen.getByTestId("widget-card-error")).toHaveTextContent(
      /"gauge" widget archetype is not rendered yet/i
    );
    expect(screen.getByText("Load gauge")).toBeInTheDocument();
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
          size: gridBounds(6),
          component: "@t/x#Body",
        }}
        slot={countSlot(1)}
      />
    );
    expect(screen.getByTestId("widget-card-body")).toHaveTextContent("body");
    expect(screen.getAllByRole("heading", { name: "Team" })).toHaveLength(1);
  });
});

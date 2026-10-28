/**
 * A widget declared with `defineWidget` and drawn by its own component: the
 * frame draws loading, no permission and error itself, the component is called
 * only once there is data and is handed the props its declaration types
 * (`WidgetProps`), its size follows the card's tier, and a throw while drawing
 * puts that card alone in its error state, with a Retry that draws it again
 * once the answer it asked for has settled.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeclaredComponentProps } from "nextly/widget-result";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { DeclaredComponent } from "../declared-component";
import { DrawFailureContext } from "../draw-failures";
import { CardTierContext } from "../frame/tier";
import { WidgetRenderer } from "../WidgetRenderer";

import { gridBounds } from "./grid-bounds";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

const PATH = "@acme/admin#Revenue";

/** As the server publishes a declared widget drawn by its own component. */
const declared: DashboardWidget = {
  id: "acme/revenue",
  title: "Revenue",
  archetype: "custom",
  size: gridBounds(4),
  component: PATH,
  serverData: true,
};

const dataSlot = (
  data: number | Record<string, number | boolean>
): WidgetSlot => ({
  ok: true,
  result: { op: "data", data },
});

/** Records the props each call was handed, and draws them. */
function recording() {
  const seen: DeclaredComponentProps[] = [];
  const Revenue = (props: DeclaredComponentProps): JSX.Element => {
    seen.push(props);
    return <p data-testid="revenue">{JSON.stringify(props.data)}</p>;
  };
  registerComponent(PATH, Revenue);
  return seen;
}

describe("a declared widget drawn by its own component", () => {
  it("is called only while its card is ready or refreshing, across every state the frame draws", () => {
    // One card taken through each state in turn: the calls each state added are counted, so a
    // component drawn under the frame's own states shows up as calls where there should be none.
    const seen = recording();
    const calls: Record<string, number> = {};
    const { rerender } = render(
      <WidgetRenderer definition={declared} slot={undefined} />
    );
    calls.loading = seen.length;
    const steps: [string, WidgetSlot, boolean][] = [
      ["ready", dataSlot(3), false],
      ["refreshing", dataSlot(3), true],
      [
        "empty",
        { ok: true, empty: true, result: { op: "data", data: 0 } },
        false,
      ],
      ["error", { ok: false, error: "The store did not answer." }, false],
      [
        "no-access",
        { ok: false, code: "unavailable", error: "forbidden" },
        false,
      ],
    ];
    for (const [state, slot, isFetching] of steps) {
      const before = seen.length;
      rerender(
        <WidgetRenderer
          definition={declared}
          slot={slot}
          isFetching={isFetching}
          onRetry={() => {}}
        />
      );
      calls[state] = seen.length - before;
    }
    expect(calls.loading).toBe(0);
    expect(calls.ready).toBeGreaterThan(0);
    expect(calls.refreshing).toBeGreaterThan(0);
    expect(calls.empty).toBe(0);
    expect(calls.error).toBe(0);
    expect(calls["no-access"]).toBe(0);
    // Refreshing, it is handed the data it already had, marked as refreshing.
    expect(seen.at(-1)).toMatchObject({ data: 3, refreshing: true });
  });

  it("is drawn by the frame while its data is coming, and the component is not called", () => {
    const seen = recording();
    render(<WidgetRenderer definition={declared} slot={undefined} />);
    expect(screen.getByTestId("card-skeleton")).toBeInTheDocument();
    expect(seen).toEqual([]);
  });

  it("is drawn by the frame when its data is not the reader's, or failed", () => {
    const seen = recording();
    const { unmount } = render(
      <WidgetRenderer
        definition={declared}
        slot={{ ok: false, code: "unavailable", error: "forbidden" }}
      />
    );
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    unmount();
    const onRetry = vi.fn();
    render(
      <WidgetRenderer
        definition={declared}
        slot={{ ok: false, error: "The store did not answer." }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    // 🔴 The component never decides what an absent answer looks like.
    expect(seen).toEqual([]);
  });

  it("hands the component its data, settings, size, refreshing and retry", async () => {
    const seen = recording();
    const onRetry = vi.fn();
    render(
      <WidgetRenderer
        definition={declared}
        slot={dataSlot({ total: 42 })}
        placement={{
          id: "card-1",
          settings: { range: "30d" },
          size: { w: 6, h: 3 },
        }}
        isFetching
        onRetry={onRetry}
      />
    );
    expect(screen.getByTestId("revenue")).toHaveTextContent('{"total":42}');
    const props = seen.at(-1)!;
    expect(props).toMatchObject({
      widgetId: "acme/revenue",
      placementId: "card-1",
      settings: { range: "30d" },
      data: { total: 42 },
      refreshing: true,
    });
    // The card's drawn size in grid units, beside the tier: no named width, no `class`.
    expect(props.size).toMatchObject({ w: 6, h: 3 });
    expect(Object.keys(props.size).sort()).toEqual(["h", "tier", "w"]);
    props.retry();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("follows the card's size as its tier changes", () => {
    const seen = recording();
    const card = (tier: "small" | "large") => (
      <CardTierContext.Provider value={tier}>
        <DeclaredComponent
          definition={declared}
          placement={{ id: "card-1", settings: {}, size: { w: 3, h: 3 } }}
          data={1}
          refreshing={false}
          onCaught={() => undefined}
        />
      </CardTierContext.Provider>
    );
    const { rerender } = render(card("small"));
    expect(seen.at(-1)?.size).toEqual({ w: 3, h: 3, tier: "small" });
    rerender(card("large"));
    // 🔴 The size is read on every draw, not fixed at the first.
    expect(seen.at(-1)?.size.tier).toBe("large");
  });

  it("hands a card drawn outside an arrangement its widget's default size", () => {
    const seen = recording();
    render(
      <DeclaredComponent
        definition={{ ...declared, size: gridBounds(8, 5) }}
        placement={undefined}
        data={1}
        refreshing={false}
        onCaught={() => undefined}
      />
    );
    expect(seen.at(-1)?.size).toMatchObject({ w: 8, h: 5 });
  });

  it("takes the tier from each card's own rendered width, at three widths in one window", () => {
    // jsdom lays nothing out: each card measures the width its container states, so one
    // window holds cards 339, 340, 699 and 700 px wide, either side of both thresholds.
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const stated = this.dataset.cardId
          ? this.closest<HTMLElement>("[data-at]")?.dataset.at
          : undefined;
        if (stated === undefined) return original.call(this);
        const width = Number(stated);
        return {
          width,
          height: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      }
    );
    const seen = new Map<string, DeclaredComponentProps["size"]>();
    registerComponent(PATH, (props: DeclaredComponentProps): JSX.Element => {
      seen.set(props.placementId, props.size);
      return <p>{props.size.tier}</p>;
    });
    const widths = [339, 340, 699, 700];
    render(
      <>
        {widths.map(width => (
          <div key={width} data-at={width}>
            <WidgetRenderer
              definition={declared}
              slot={dataSlot(1)}
              placement={{
                id: `at-${width}`,
                settings: {},
                size: { w: 6, h: 3 },
              }}
            />
          </div>
        ))}
      </>
    );
    // 🔴 The same size in grid units at every width: only the card's own width moves its tier.
    expect(widths.map(width => seen.get(`at-${width}`)?.tier)).toEqual([
      "small",
      "medium",
      "medium",
      "large",
    ]);
    for (const width of widths) {
      expect(seen.get(`at-${width}`)).toMatchObject({ w: 6, h: 3 });
    }
  });

  it("hands a widget whose data is a query the query's own answer as its data", () => {
    // 🔴 Not an `op: "data"` result: a `{ query }` widget's data is the
    // query's answer itself, as `WidgetData` types it.
    const seen = recording();
    const answer = { op: "count" as const, total: 3 };
    render(
      <WidgetRenderer
        definition={declared}
        slot={{ ok: true, result: answer }}
      />
    );
    expect(screen.queryByTestId("widget-card-error")).toBeNull();
    expect(seen.at(-1)?.data).toEqual(answer);
  });

  it("puts the card itself in its error state when its component throws, and leaves the card beside it alone", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerComponent(PATH, (): JSX.Element => {
      throw new Error("boom");
    });
    registerComponent("@acme/admin#Other", () => <p>other card</p>);
    const reports: [string, boolean][] = [];
    render(
      <DrawFailureContext.Provider
        value={(id, failed) => reports.push([id, failed])}
      >
        <WidgetRenderer
          definition={declared}
          slot={dataSlot(1)}
          placement={{ id: "card-1", settings: {} }}
          onRetry={vi.fn()}
        />
        <WidgetRenderer
          definition={{
            ...declared,
            id: "acme/other",
            title: "Other",
            component: "@acme/admin#Other",
          }}
          slot={dataSlot(2)}
          placement={{ id: "card-2", settings: {} }}
        />
      </DrawFailureContext.Provider>
    );
    // The card's own error state, not a body swapped inside a ready card.
    const card = screen.getByRole("region", { name: "Revenue" });
    expect(card).toHaveAttribute("data-state", "error");
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    expect(
      screen.queryByText(/This plugin component failed to load/)
    ).toBeNull();
    // The grid is told, so it counts the card as failed.
    expect(reports).toContainEqual(["card-1", true]);
    expect(reports).not.toContainEqual(["card-2", true]);
    expect(screen.getByText("other card")).toBeInTheDocument();
  });

  it("draws again on Retry only once the answer it asked for has settled, and recovers when that answer draws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Fails while `fail` holds or its data is bad: what the retry fixes is
    // not known when Retry is pressed, only once its answer is in.
    let fail = true;
    registerComponent(PATH, (props: DeclaredComponentProps): JSX.Element => {
      if (fail || (props.data as { bad?: boolean }).bad) {
        throw new Error("cannot draw");
      }
      return <p data-testid="revenue">drawn</p>;
    });
    const onRetry = vi.fn();
    const answer = dataSlot({ total: 5 });
    const card = (slot: WidgetSlot, isFetching: boolean) => (
      <WidgetRenderer
        definition={declared}
        slot={slot}
        isFetching={isFetching}
        onRetry={onRetry}
      />
    );
    const { rerender } = render(card(answer, false));
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry Revenue" })
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The retry's answer is on its way, and what broke the draw is fixed.
    fail = false;
    rerender(card(answer, true));
    // 🔴 It settles as the same answer (unchanged data keeps its object):
    // drawn again now, though nothing new arrived. Drawn again on the click
    // instead, it would have failed while `fail` held, and stayed failed.
    rerender(card(answer, false));
    expect(screen.getByTestId("revenue")).toHaveTextContent("drawn");
    // A failure that depends on the data: failed for the bad answer, drawn for
    // the next good one, with no click.
    rerender(card(dataSlot({ bad: true }), false));
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    rerender(card(dataSlot({ total: 6 }), false));
    expect(screen.getByTestId("revenue")).toHaveTextContent("drawn");
  });

  it("draws again at once on Retry when there is no answer to ask again for", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    registerComponent(PATH, (): JSX.Element => {
      if (fail) throw new Error("boom");
      return <p data-testid="revenue">drawn</p>;
    });
    render(<WidgetRenderer definition={declared} slot={dataSlot(1)} />);
    expect(screen.getByTestId("widget-card-error")).toBeInTheDocument();
    fail = false;
    await userEvent.click(
      screen.getByRole("button", { name: "Retry Revenue" })
    );
    expect(screen.getByTestId("revenue")).toHaveTextContent("drawn");
  });

  it("leaves a core custom card, which asks its own questions, drawing its own states", () => {
    // The control: without `serverData` a custom card is self-drawn, handed
    // its slot, as core's own custom cards are.
    const props: unknown[] = [];
    registerComponent(PATH, (p: unknown) => {
      props.push(p);
      return <p>self drawn</p>;
    });
    render(
      <WidgetRenderer
        definition={{ ...declared, serverData: undefined }}
        slot={undefined}
      />
    );
    expect(screen.getByText("self drawn")).toBeInTheDocument();
    expect(props.at(-1)).toHaveProperty("slot", undefined);
  });
});

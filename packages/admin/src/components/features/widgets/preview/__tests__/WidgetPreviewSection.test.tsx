/**
 * One widget on the preview page, drawn by the dashboard's own renderer.
 *
 * What separates a correct section from a plausible broken one: a widget with
 * no case says so in place of its ready state and STILL draws every other
 * state (a section that bailed out on no case would show the message alone);
 * a case is drawn as its card draws a real answer (its value, in the card's
 * ready state, not the raw data); every size is drawn; and a card that draws
 * a state itself, with live data, is never mounted for that state.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { UNAVAILABLE_TITLE } from "../../frame/states";
import { GRID_CLASS, GRID_COLUMNS_CLASS } from "../../sizes";
import type { WidgetPreview } from "../types";
import { previewSizes, WidgetPreviewSection } from "../WidgetPreviewSection";
import { NO_PREVIEW_CASE, NOT_REACHED } from "../WidgetPreviewState";

// A self-drawn card's component reads live data, so it must never mount here.
const pluginSlot = vi.fn((_props: { path: string }) => null);
vi.mock("@admin/components/shared/plugin-slot", () => ({
  PluginSlot: (props: { path: string }) => pluginSlot(props),
}));

const SIZE = {
  min: { w: 3, h: 2 },
  default: { w: 4, h: 2 },
  max: { w: 12, h: 2 },
};

/** A declared widget drawn by the figure view, as the admin resolves it. */
const openOrders: DashboardWidget = {
  id: "acme/open-orders",
  title: "Open orders",
  archetype: "metric",
  size: SIZE,
  serverData: true,
  declaredEmpty: { title: "No open orders" },
};

function previewOf(cases: WidgetPreview["preview"]): WidgetPreview {
  return {
    id: openOrders.id,
    title: openOrders.title,
    owner: 'plugin "@acme/shop"',
    size: SIZE,
    view: "figure",
    preview: cases,
    empty: { message: "No open orders" },
  };
}

/** Every drawn state of one kind, by its wrapper. */
function statesNamed(state: string): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `[data-preview-state="${state}"]`
    ),
  ];
}

/** The card's own state, as the frame marks it. */
function frameStateOf(wrapper: HTMLElement): string | null {
  return (
    wrapper.querySelector("[data-card-id]")?.getAttribute("data-state") ?? null
  );
}

describe("a widget on the preview page", () => {
  it("says it has no preview case in place of its ready state, and still draws every other state", () => {
    render(
      <WidgetPreviewSection preview={previewOf([])} definition={openOrders} />
    );

    const sizes = previewSizes(SIZE).length;
    expect(sizes).toBe(3);
    // In place of the ready state, at every size, and no ready card drawn.
    const ready = statesNamed("ready");
    expect(ready).toHaveLength(sizes);
    for (const wrapper of ready) {
      expect(within(wrapper).getByText(NO_PREVIEW_CASE)).toBeInTheDocument();
      expect(wrapper.querySelector("[data-card-id]")).toBeNull();
    }
    // The control: every frame state is still drawn by the frame, at every size.
    for (const [state, frame] of [
      ["loading", "loading"],
      ["empty", "empty"],
      ["error", "error"],
      ["unavailable", "unavailable"],
    ] as const) {
      const drawn = statesNamed(state);
      expect(drawn, state).toHaveLength(sizes);
      for (const wrapper of drawn) expect(frameStateOf(wrapper)).toBe(frame);
    }
    // The empty state in the widget's own words, the unavailable in the frame's.
    expect(
      within(statesNamed("empty")[0]!).getByText("No open orders")
    ).toBeInTheDocument();
    expect(
      within(statesNamed("unavailable")[0]!).getByText(UNAVAILABLE_TITLE)
    ).toBeInTheDocument();
  });

  it("draws each case's ready state as the card draws a real answer, at each size", () => {
    render(
      <WidgetPreviewSection
        preview={previewOf([
          {
            name: "Busy",
            data: { total: 42 },
            result: { op: "count", total: 42 },
          },
        ])}
        definition={openOrders}
      />
    );

    const ready = statesNamed("ready");
    expect(ready.map(wrapper => wrapper.dataset.previewSize)).toEqual([
      "3x2",
      "4x2",
      "12x2",
    ]);
    for (const wrapper of ready) {
      expect(wrapper.dataset.previewCase).toBe("Busy");
      expect(frameStateOf(wrapper)).toBe("ready");
      expect(within(wrapper).getByText("42")).toBeInTheDocument();
    }
    expect(screen.queryByText(NO_PREVIEW_CASE)).toBeNull();
  });

  it("never mounts a self-drawn card for a state it draws itself, and says so in its place", () => {
    const content: DashboardWidget = {
      id: "core/content",
      title: "Content",
      archetype: "custom",
      component: "core#Content",
      size: SIZE,
    };
    render(
      <WidgetPreviewSection
        preview={{ ...previewOf([]), id: content.id, title: content.title }}
        definition={content}
      />
    );

    for (const wrapper of statesNamed("loading")) {
      expect(within(wrapper).getByText(NOT_REACHED)).toBeInTheDocument();
    }
    // Its error and not-available states are the frame's, drawn without it.
    for (const wrapper of statesNamed("error")) {
      expect(frameStateOf(wrapper)).toBe("error");
    }
    expect(pluginSlot).not.toHaveBeenCalled();
  });

  it("lays each size's cards on the dashboard's own columns and gaps", () => {
    render(
      <WidgetPreviewSection preview={previewOf([])} definition={openOrders} />
    );
    const columns = GRID_COLUMNS_CLASS.split(" ");
    // The columns' classes are the dashboard grid's own, so a card here is as
    // wide as there and lands in the same tier.
    for (const name of columns) expect(GRID_CLASS.split(" ")).toContain(name);
    // Each size's grid, directly inside the container its spans answer to;
    // the cards' own grids inside them are not this one.
    const grids = [
      ...document.querySelectorAll<HTMLElement>(
        '[class~="@container/dashboard"] > div'
      ),
    ];
    expect(grids.length).toBe(previewSizes(SIZE).length);
    for (const grid of grids) {
      for (const name of columns) expect(grid.classList).toContain(name);
    }
  });

  it("says when the admin holds no declaration to draw a listed widget with", () => {
    render(
      <WidgetPreviewSection preview={previewOf([])} definition={undefined} />
    );
    expect(screen.getByTestId("not-drawn-here")).toBeInTheDocument();
    expect(statesNamed("loading")).toHaveLength(0);
  });
});

describe("the sizes a widget is drawn at", () => {
  it("draws coinciding ends once, named for each", () => {
    expect(
      previewSizes({
        min: { w: 4, h: 2 },
        default: { w: 4, h: 2 },
        max: { w: 12, h: 2 },
      }).map(named => named.label)
    ).toEqual(["Smallest and default", "Largest"]);
  });
});

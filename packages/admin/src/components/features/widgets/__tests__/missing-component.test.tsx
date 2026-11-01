/**
 * A widget drawn by its own component, when the admin holds no component at its path (the app's
 * component map was generated before the widget, or is not imported): that card alone draws its
 * error state, with no Retry, and the grid counts it as failed. In development the error names
 * the widget, its owner, the path and the fix; in production only that it could not be loaded,
 * as the server says which it is running in.
 */
import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";
import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

let branding: AdminBranding = {};
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));

import { COMPONENT_MISSING, DrawFailureContext } from "../draw-failures";
import { WidgetRenderer } from "../WidgetRenderer";

import { gridBounds } from "./grid-bounds";

const PATH = "@acme/admin#Revenue";

/** As the server publishes a declared widget drawn by its own component. */
const declared: DashboardWidget = {
  id: "acme/revenue",
  title: "Revenue",
  archetype: "custom",
  size: gridBounds(4),
  component: PATH,
  owner: 'plugin "@acme/shop"',
  serverData: true,
};

const answered: WidgetSlot = { ok: true, result: { op: "data", data: 1 } };

beforeEach(() => {
  branding = {};
  // The registry warns about a path it does not hold; the card says it instead.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

/** Draws the card with its answer, beside a card whose component is there, and the reports. */
function drawWithNeighbour(): [string, boolean][] {
  registerComponent("@acme/admin#Other", (): JSX.Element => <p>other card</p>);
  const reports: [string, boolean][] = [];
  render(
    <DrawFailureContext.Provider
      value={(id, failed) => reports.push([id, failed])}
    >
      <WidgetRenderer
        definition={declared}
        slot={answered}
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
        slot={answered}
        placement={{ id: "card-2", settings: {} }}
      />
    </DrawFailureContext.Provider>
  );
  return reports;
}

describe("a card whose component the admin does not hold", () => {
  it("draws its own error state, and the card beside it draws, and the grid counts it failed", () => {
    const reports = drawWithNeighbour();
    expect(screen.getByRole("region", { name: "Revenue" })).toHaveAttribute(
      "data-state",
      "error"
    );
    expect(screen.getByRole("region", { name: "Other" })).toHaveAttribute(
      "data-state",
      "ready"
    );
    expect(screen.getByText("other card")).toBeInTheDocument();
    expect(reports).toContainEqual(["card-1", true]);
    expect(reports).not.toContainEqual(["card-2", true]);
  });

  it("offers no Retry, since drawing again would find the same registry", () => {
    drawWithNeighbour();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("names the widget, its owner, the path and the fix in development", () => {
    branding = { devReload: true };
    drawWithNeighbour();
    const error = screen.getByTestId("widget-card-error");
    expect(error).toHaveTextContent(
      'Widget "acme/revenue" of plugin "@acme/shop" draws with @acme/admin#Revenue, which is not in the app\'s component map.'
    );
    expect(error).toHaveTextContent("Run `npx nextly generate:types`");
  });

  it("says only that it could not be loaded in production, naming no path", () => {
    drawWithNeighbour();
    const error = screen.getByTestId("widget-card-error");
    expect(error).toHaveTextContent(COMPONENT_MISSING);
    expect(error).not.toHaveTextContent(PATH);
    expect(error).not.toHaveTextContent("acme/shop");
  });

  it("draws its error in place of a component that draws without an answer, too", () => {
    // A custom card with no query: its component draws without one.
    const selfDrawn: DashboardWidget = {
      id: declared.id,
      title: declared.title,
      archetype: "custom",
      size: declared.size,
      component: PATH,
    };
    render(<WidgetRenderer definition={selfDrawn} slot={undefined} />);
    expect(screen.getByRole("region", { name: "Revenue" })).toHaveAttribute(
      "data-state",
      "error"
    );
  });

  it("says first that the reader may not see it, before any word about its component", () => {
    render(
      <WidgetRenderer
        definition={declared}
        slot={{ ok: false, code: "unavailable", error: "forbidden" }}
      />
    );
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-card-error")).toBeNull();
  });

  it("draws the component once it is there", () => {
    registerComponent(PATH, (): JSX.Element => <p>revenue drawn</p>);
    render(<WidgetRenderer definition={declared} slot={answered} />);
    expect(screen.getByText("revenue drawn")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-card-error")).toBeNull();
  });
});

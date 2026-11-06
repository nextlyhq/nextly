/**
 * The dashboard's place: plugins' blocks stand around the page's own two
 * parts, the welcome header and the grid of cards, in the order the server
 * sent, each behind its own boundary and told who is looking. A block placed
 * by nothing follows the grid; one placed before `widgets` goes between the
 * two. The grid itself is drawn as it is. With nothing contributed the page
 * is unchanged.
 */
import { render, screen } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
}));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: meta.user }),
}));
// The page's own two parts, as markers: what is read here is where the page
// puts them and what stands around them.
vi.mock("@admin/components/features/dashboard/WelcomeHeader", () => ({
  WelcomeHeader: () => <h1 data-testid="welcome">Welcome, Ada</h1>,
}));
vi.mock("@admin/components/features/widgets/WidgetGrid", () => ({
  WidgetGrid: () => <section data-testid="widgets">the cards</section>,
}));

import DashboardPage from "./index";

function component(path: string, testId: string): string {
  registerComponent(path, ((props: { context?: unknown }) => (
    <aside data-testid={testId}>{JSON.stringify(props.context)}</aside>
  )) as never);
  return path;
}
const ABOVE = component("@acme/a/admin#Above", "above-block");
const BELOW = component("@acme/a/admin#Below", "below-block");
const HELLO = component("@acme/a/admin#Hello", "hello-block");
const THROWS = "@acme/a/admin#Throws";
registerComponent(THROWS, (() => {
  throw new Error("the block failed");
}) as never);

function block(id: string, path: string, extra: object = {}) {
  return { plugin: "@acme/a", id, kind: "block", component: path, ...extra };
}

function blocks(...entries: object[]): void {
  meta.contributions = {
    dashboard: { block: entries },
  } as AdminContributionsMeta;
}

/** The test ids of the page's parts and blocks, top to bottom. */
function drawn(): string[] {
  return Array.from(document.querySelectorAll("[data-testid]"))
    .map(node => node.getAttribute("data-testid") ?? "")
    .filter(id => id !== "page-container");
}

beforeEach(() => {
  meta.contributions = undefined;
  meta.user = { id: SIGNED_IN };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the dashboard's place", () => {
  it("with no contributions the dashboard draws as before", () => {
    render(<DashboardPage />);

    // The header and the grid, side by side in the page's column, as they
    // were: nothing wraps them and nothing is added.
    const welcome = screen.getByTestId("welcome");
    const widgets = screen.getByTestId("widgets");
    expect(drawn()).toEqual(["welcome", "widgets"]);
    expect(welcome.nextElementSibling).toBe(widgets);
    expect(welcome.parentElement).toBe(widgets.parentElement);
  });

  it("draws a block placed by nothing after the grid, and one placed before it between the header and the grid", () => {
    // As the server orders them: the built-ins chained, a block with no
    // anchor after the last, one `before: "widgets"` between.
    blocks(
      { builtIn: "welcome" },
      block("acme-a.above", ABOVE, { before: "widgets" }),
      { builtIn: "widgets" },
      block("acme-a.below", BELOW)
    );
    render(<DashboardPage />);

    expect(drawn()).toEqual([
      "welcome",
      "above-block",
      "widgets",
      "below-block",
    ]);
    // In the page's own column, beside the header and the grid.
    expect(screen.getByTestId("above-block").parentElement).toBe(
      screen.getByTestId("widgets").parentElement
    );
  });

  it("tells a block who is looking", () => {
    blocks(
      { builtIn: "welcome" },
      { builtIn: "widgets" },
      block("acme-a.below", BELOW)
    );
    render(<DashboardPage />);

    expect(
      JSON.parse(screen.getByTestId("below-block").textContent ?? "")
    ).toEqual({ userId: SIGNED_IN });
  });

  it("draws a block replacing the welcome header in its place, the grid staying", () => {
    blocks(block("acme-a.hello", HELLO, { replaces: "welcome" }), {
      builtIn: "widgets",
    });
    render(<DashboardPage />);

    expect(drawn()).toEqual(["hello-block", "widgets"]);
  });

  it("a throwing block draws its own fallback, and the header and the grid stay", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    blocks(
      { builtIn: "welcome" },
      { builtIn: "widgets" },
      block("acme-a.broken", THROWS)
    );
    render(<DashboardPage />);

    expect(screen.getByTestId("welcome")).toBeInTheDocument();
    expect(screen.getByTestId("widgets")).toBeInTheDocument();
    // Not the page's crash screen: the boundary is the block's own.
    expect(
      screen.queryByText("The dashboard couldn't load")
    ).not.toBeInTheDocument();
  });

  it("draws no block before the viewer is known", () => {
    meta.user = null;
    blocks(
      { builtIn: "welcome" },
      { builtIn: "widgets" },
      block("acme-a.below", BELOW)
    );
    render(<DashboardPage />);

    expect(drawn()).toEqual(["welcome", "widgets"]);
  });
});

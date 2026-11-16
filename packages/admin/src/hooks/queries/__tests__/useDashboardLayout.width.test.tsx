/**
 * The layout read is sent the dashboard's width as it measures when the read is asked, so the
 * server judges each card that hides while empty at the tier the card's first query will ask at
 * (`predictedTier` of the same width). With no dashboard drawn, or one with no width yet, none is
 * sent and the answer judges no card. The answer is held with the width it was sent, so a cached
 * one drawn at another width is known for what it is.
 */
import { render } from "@testing-library/react";
import { useRef, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardWidth } from "@admin/components/features/widgets/useDashboardWidth";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: api }));

import { fetchDashboardLayout } from "../useDashboardLayout";

/** The width the dashboard's container lays out at, as the browser would measure it. */
let laidOut = 0;

/** A dashboard's container, measured as the grid measures its own. */
function Dashboard(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDashboardWidth(ref);
  return <div ref={ref} data-testid="dashboard" />;
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width: laidOut }) as DOMRect
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the layout read", () => {
  it("is sent the drawn dashboard's width, unrounded, as it measures when the read is asked", async () => {
    laidOut = 1199.5;
    render(<Dashboard />);
    await fetchDashboardLayout();
    expect(api.get).toHaveBeenLastCalledWith("/dashboard/layout?width=1199.5");

    // A resize between two reads: each is sent the width it was asked at.
    laidOut = 900;
    await fetchDashboardLayout();
    expect(api.get).toHaveBeenLastCalledWith("/dashboard/layout?width=900");
  });

  it("is sent no width off the dashboard, or before the dashboard has one", async () => {
    laidOut = 1200;
    const { unmount } = render(<Dashboard />);
    unmount();
    await fetchDashboardLayout();
    expect(api.get).toHaveBeenLastCalledWith("/dashboard/layout");

    // Laid out at no width yet: zero is no width, as `useMeasuredWidth` reads it.
    laidOut = 0;
    render(<Dashboard />);
    await fetchDashboardLayout();
    expect(api.get).toHaveBeenLastCalledWith("/dashboard/layout");
  });

  it("is answered with the width it was sent, which its verdict was judged at", async () => {
    api.get.mockResolvedValue({ hiddenWhileEmpty: ["p-1"] });
    laidOut = 1199.5;
    const { unmount } = render(<Dashboard />);
    // Held beside the answer, so a cached answer drawn at another width can be told apart.
    await expect(fetchDashboardLayout()).resolves.toEqual({
      hiddenWhileEmpty: ["p-1"],
      askedAtWidth: 1199.5,
    });

    // Sent no width, the answer carries none: it judged no card.
    unmount();
    const unjudged = await fetchDashboardLayout();
    expect(unjudged).not.toHaveProperty("askedAtWidth");
  });
});

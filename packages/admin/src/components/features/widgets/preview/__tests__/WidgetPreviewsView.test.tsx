/**
 * The preview page's accessibility check, run on each drawn state and shown
 * beside it.
 *
 * What separates a correct check from a plausible broken one: each state's
 * findings are its own (a check run once over the page and shown on every
 * state would mark the clean states too), they are counted as blocking only
 * when serious or critical, and a page holding no axe says so rather than
 * marking every state as having no findings that nobody looked for.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import type { WidgetPreview } from "../types";
import {
  NO_ACCESSIBILITY_CHECK,
  WidgetPreviewsView,
} from "../WidgetPreviewsView";

const SIZE = {
  min: { w: 4, h: 2 },
  default: { w: 4, h: 2 },
  max: { w: 4, h: 2 },
};

const openOrders: DashboardWidget = {
  id: "acme/open-orders",
  title: "Open orders",
  archetype: "metric",
  size: SIZE,
  serverData: true,
};

vi.mock("../../resolve-widgets", () => ({
  resolveDashboardWidgets: () => [openOrders],
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));

const previews: WidgetPreview[] = [
  {
    id: openOrders.id,
    title: openOrders.title,
    size: SIZE,
    view: "figure",
    preview: [
      { name: "Busy", data: { total: 42 }, result: { op: "count", total: 42 } },
    ],
  },
];

/**
 * A stand-in for axe-core's `run`: a serious finding in a card showing an
 * error, a moderate one in a loading card, and nothing anywhere else.
 */
const run = vi.fn(async (context: Element) => {
  const state = context
    .closest("[data-preview-state]")
    ?.getAttribute("data-preview-state");
  const violations =
    state === "error"
      ? [
          {
            id: "label",
            impact: "serious",
            help: "Form elements must have labels",
            nodes: [{}],
          },
        ]
      : state === "loading"
        ? [
            {
              id: "region",
              impact: "moderate",
              help: "Content in regions",
              nodes: [{}, {}],
            },
          ]
        : [];
  return { violations, passes: [] };
});

afterEach(() => {
  delete (globalThis as { axe?: unknown }).axe;
  run.mockClear();
});

function findingsOf(state: string): HTMLElement {
  const wrapper = document.querySelector(`[data-preview-state="${state}"]`);
  const findings = wrapper?.querySelector<HTMLElement>(
    "[data-preview-findings]"
  );
  if (!findings) throw new Error(`no findings beside the ${state} state`);
  return findings;
}

describe("the preview page's accessibility check", () => {
  it("shows each state's own findings beside it, blocking only on serious or critical", async () => {
    (globalThis as { axe?: unknown }).axe = { run };
    render(<WidgetPreviewsView previews={previews} />);
    expect(findingsOf("ready").dataset.previewFindings).toBe("unchecked");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check accessibility" })
      );
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId("accessibility-status").dataset.check).toBe(
        "done"
      )
    );

    // Run once per drawn state, on the card alone: the ready case and four frame states.
    expect(run).toHaveBeenCalledTimes(5);
    for (const [element] of run.mock.calls) {
      expect(element.hasAttribute("data-preview-card")).toBe(true);
    }
    expect(findingsOf("error").dataset.blocking).toBe("1");
    expect(
      findingsOf("error").querySelector('[data-rule="label"]')
    ).not.toBeNull();
    // A moderate finding is shown, and does not block.
    expect(findingsOf("loading").dataset.blocking).toBe("0");
    expect(findingsOf("loading").textContent).toContain("2 elements");
    // The control: the clean states say they were checked and found nothing.
    for (const state of ["ready", "empty", "unavailable"]) {
      expect(findingsOf(state).dataset.previewFindings, state).toBe("none");
    }
    expect(screen.getByTestId("accessibility-status").textContent).toBe(
      "Checked 5 states in light: 1 with serious or critical findings."
    );
  });

  it("says no check is loaded where the page holds no axe, and marks nothing as checked", async () => {
    render(<WidgetPreviewsView previews={previews} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check accessibility" })
      );
    });
    expect(screen.getByTestId("accessibility-status").textContent).toBe(
      NO_ACCESSIBILITY_CHECK
    );
    expect(findingsOf("ready").dataset.previewFindings).toBe("unchecked");
  });
});

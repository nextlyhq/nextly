/**
 * One state of one widget on the preview page, handed to the dashboard's own
 * renderer.
 *
 * What separates a correct state from a plausible broken one: the placement it
 * hands the renderer carries the case's settings resolved as a dashboard card's
 * are (`settingsAsAsked`), so a setting the case leaves out arrives at the
 * widget's default rather than missing; and a setting the case names wins.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { readyAnswer } from "../preview-states";
import { WidgetPreviewState } from "../WidgetPreviewState";

const rendered = vi.fn(
  (_props: { placement: { settings: Record<string, unknown> } }) => null
);
vi.mock("../../WidgetRenderer", () => ({
  WidgetRenderer: (props: {
    placement: { settings: Record<string, unknown> };
  }) => rendered(props),
}));

/** A declared figure card with one setting that has a default. */
const openOrders = {
  id: "acme/open-orders",
  title: "Open orders",
  archetype: "metric",
  size: { min: { w: 3, h: 2 }, default: { w: 4, h: 2 }, max: { w: 12, h: 2 } },
  serverData: true,
  settings: [
    {
      name: "tone",
      label: "Tone",
      type: "select",
      defaultValue: "calm",
      options: [
        { label: "Calm", value: "calm" },
        { label: "Loud", value: "loud" },
      ],
    },
  ],
} as DashboardWidget;

function drawReady(settings: Record<string, unknown>): void {
  rendered.mockClear();
  render(
    <WidgetPreviewState
      stateKey="acme/open-orders:4x2:ready"
      definition={openOrders}
      state="ready"
      size={{ w: 4, h: 2 }}
      answer={readyAnswer({ op: "count", total: 3 })}
      caseName="Busy"
      settings={settings}
    />
  );
}

describe("a preview state's settings", () => {
  it("hands the renderer the widget's default for a setting the case leaves out", () => {
    drawReady({});
    expect(rendered).toHaveBeenCalled();
    expect(rendered.mock.calls[0]?.[0].placement.settings).toEqual({
      tone: "calm",
    });
  });

  it("hands the renderer the case's own value where it names one", () => {
    drawReady({ tone: "loud" });
    expect(rendered.mock.calls[0]?.[0].placement.settings).toEqual({
      tone: "loud",
    });
  });
});

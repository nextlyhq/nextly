/**
 * What a card's answer was fetched with, as its list counts rows by it: the "Number of entries"
 * its settings asked for, and only for a widget that declares that setting. A widget's own
 * component may hand its list a limit of its own, with no such setting, and its answer must not
 * then be held to the default five.
 */
import { describe, expect, it } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { gridBounds } from "../../__tests__/grid-bounds";
import { answerSizeOf } from "../ArrangedGrid";

const LIMIT = {
  name: "limit",
  type: "number",
  label: "Number of entries",
  defaultValue: 5,
  min: 1,
  max: 20,
} as const;

function widget(settings?: DashboardWidget["settings"]): DashboardWidget {
  return {
    id: "acme/orders",
    title: "Orders",
    archetype: "custom",
    component: "acme#Orders",
    size: gridBounds(6),
    ...(settings === undefined ? {} : { settings }),
  };
}

describe("answerSizeOf", () => {
  it("is the Number of entries an answer was asked with, for a widget that declares it", () => {
    expect(
      answerSizeOf(widget([LIMIT]), { settings: { limit: 10 } }, undefined)
    ).toEqual({ items: 10 });
  });

  it("reads a missing value as the widget's own default", () => {
    expect(answerSizeOf(widget([LIMIT]), { settings: {} }, undefined)).toEqual({
      items: 5,
    });
  });

  it("holds nothing for a widget that declares no Number of entries", () => {
    // Its component's own `limit` decides its rows; `{ items: undefined }` would read as five.
    expect(
      answerSizeOf(widget(), { settings: { limit: 10 } }, undefined)
    ).toBeUndefined();
    expect(
      answerSizeOf(widget([]), { settings: {} }, undefined)
    ).toBeUndefined();
  });

  it("holds nothing for an answer not asked", () => {
    expect(answerSizeOf(widget([LIMIT]), undefined, undefined)).toBeUndefined();
  });
});

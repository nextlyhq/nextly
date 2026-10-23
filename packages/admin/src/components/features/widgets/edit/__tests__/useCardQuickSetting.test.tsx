/**
 * When a quick setting's change is announced: once the card shows it.
 *
 * A change that alters the card's query is asked again for that card alone, and the old answer
 * stays on screen until the new one arrives. A quiet re-ask that is refused keeps the old answer
 * for good, so the end of the fetch alone does not say the card shows the change: the card's
 * answer time has to move. A refused one is still announced, as saved but not shown.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import {
  useCardQuickSetting,
  type CellSettingsWrite,
} from "../useCardQuickSetting";

// No quick setting drives a query knob yet, so the query a setting asks is stood in for here:
// the chosen range becomes part of the query, which is what makes the change ask again.
vi.mock("../../widget-as-asked", () => {
  const widgetAsAsked = (
    widget: DashboardWidget,
    config: Record<string, unknown> | undefined
  ) => ({ ...widget, query: { ...widget.query, range: config?.range } });
  return {
    widgetAsAsked,
    // What the card asks with, over the same stand-in: for a widget with a query, the real one
    // is its query as `widgetAsAsked` writes it.
    questionOf: (
      widget: DashboardWidget,
      config: Record<string, unknown> | undefined
    ) => JSON.stringify(widgetAsAsked(widget, config).query),
  };
});

const WIDGET: DashboardWidget = {
  id: "core/activity",
  title: "Activity",
  archetype: "custom",
  size: "md",
  query: { source: "collection:posts", op: "list", limit: 5 },
  settings: [
    {
      name: "range",
      type: "select",
      label: "Date range",
      quick: true,
      defaultValue: "7d",
      options: [
        { label: "Last 7 days", value: "7d" },
        { label: "Last 30 days", value: "30d" },
      ],
    },
  ],
};

const SHOWN = new Date(1_000);
const REPLACED = new Date(2_000);

/** A card whose change lands at once, then is asked again and settles at `settledAt`. */
function changeAndSettle(settledAt: Date) {
  const announce = vi.fn();
  const settingsWrite: CellSettingsWrite = {
    write: (_config, callbacks) => callbacks.onLanded?.(),
    isWriting: false,
    announce,
  };
  const base = {
    widget: WIDGET,
    config: undefined,
    isEditing: false,
    isFetching: false,
    updatedAt: SHOWN,
    settingsWrite,
  };
  const { result, rerender } = renderHook(props => useCardQuickSetting(props), {
    initialProps: base,
  });
  act(() => result.current.menu?.change("30d"));
  rerender({ ...base, isFetching: true });
  rerender({ ...base, isFetching: false, updatedAt: settledAt });
  return announce;
}

describe("a quick setting that asks the card again", () => {
  it("is announced once the card's new answer arrives", () => {
    const announce = changeAndSettle(REPLACED);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Date range", "Last 30 days", true);
  });

  it("is announced as saved but not shown when the re-ask is refused and the old answer stays", () => {
    const announce = changeAndSettle(SHOWN);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Date range", "Last 30 days", false);
  });
});

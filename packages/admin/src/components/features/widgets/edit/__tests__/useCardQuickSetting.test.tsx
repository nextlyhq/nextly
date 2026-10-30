/**
 * A card's quick settings, as the header's control and the quick popover change them.
 *
 * At rest a change is written at once and offered back with Undo, which writes what the card had
 * just before THAT change; while customising it is staged in the draft and nothing is written. A
 * new collection resets the settings that work over it. Said once, in the toast that offers Undo,
 * once the card shows the change:
 * a change that alters the card's query is asked again for that card alone, and the old answer
 * stays on screen until the new one arrives; a quiet re-ask that is refused keeps the old answer
 * for good, so it is announced as saved but not shown.
 */
import { act, renderHook } from "@testing-library/react";
import type { PublishedContentSource } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { gridBounds } from "../../__tests__/grid-bounds";
import type { QuickSetting } from "../quick-setting";
import type { CardSettingsWriteCallbacks } from "../useCardSettingsWrite";
import {
  useCardQuickSetting,
  type CellSettingsWrite,
  type CellStagedWrite,
} from "../useCardQuickSetting";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const sources = vi.hoisted(() => ({ value: [] as PublishedContentSource[] }));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ widgetSources: sources.value }),
}));

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
    askableWith: () => true,
  };
});

/** The widget's quick setting: its range. */
const range: QuickSetting = {
  name: "range",
  type: "select",
  label: "Date range",
  quick: true,
  defaultValue: "7d",
  options: [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
    { label: "Last 90 days", value: "90d" },
  ],
};

const WIDGET: DashboardWidget = {
  id: "core/activity",
  title: "Activity",
  archetype: "custom",
  // Resizable, so the popover holds a Size.
  size: { default: { w: 4, h: 3 }, min: { w: 3, h: 2 }, max: { w: 12, h: 6 } },
  query: { source: "collection:posts", op: "list", limit: 5 },
  settings: [
    range,
    // Changed in the sheet, never quick: what a later save changes beside the quick setting.
    { name: "limit", type: "number", label: "Rows", defaultValue: 5 },
  ],
};

const SHOWN = new Date(1_000);
const REPLACED = new Date(2_000);

/** A write whose every change lands at once. */
function landingWrite(patch: Partial<CellSettingsWrite> = {}) {
  const write = vi.fn(
    (_config: Record<string, unknown>, callbacks: CardSettingsWriteCallbacks) =>
      callbacks.onLanded?.()
  );
  const resize = vi.fn(
    (_size: { w: number; h: number }, callbacks: CardSettingsWriteCallbacks) =>
      callbacks.onLanded?.()
  );
  const settingsWrite: CellSettingsWrite = {
    write,
    resize,
    isWriting: false,
    ...patch,
  };
  return { settingsWrite, write, resize };
}

function staging(): CellStagedWrite {
  return { config: vi.fn(), size: vi.fn(), isWriting: false };
}

function base(
  settingsWrite: CellSettingsWrite | undefined,
  patch: Partial<Parameters<typeof useCardQuickSetting>[0]> = {}
): Parameters<typeof useCardQuickSetting>[0] {
  return {
    placementId: "p1",
    widget: WIDGET,
    title: "Activity",
    config: undefined,
    size: { w: 4, h: 3 },
    isEditing: false,
    isFetching: false,
    updatedAt: SHOWN,
    settingsWrite,
    staged: staging(),
    ...patch,
  };
}

type Props = Parameters<typeof useCardQuickSetting>[0];

/**
 * The card asked again for a change that alters its query, and answered `at`: the new answer
 * when `at` is later than the one shown, the old one kept when the re-ask was refused.
 */
function settle(rerender: (props: Props) => void, props: Props, at: Date) {
  rerender({ ...props, isFetching: true });
  rerender({ ...props, isFetching: false, updatedAt: at });
}

/** What each toast said, in order. */
function toasts(): string[] {
  return toast.success.mock.calls.map(call => String(call[0]));
}

/** The Undo of the latest toast, as the reader would press it. */
function pressUndo() {
  const options = toast.success.mock.calls.at(-1)?.[1] as
    | { action?: { onClick: () => void } }
    | undefined;
  if (!options?.action) throw new Error("no Undo offered");
  act(() => options.action?.onClick());
}

beforeEach(() => {
  vi.clearAllMocks();
  sources.value = [];
});

/** A card whose change lands at once, then is asked again and settles at `settledAt`. */
function changeAndSettle(settledAt: Date) {
  const { settingsWrite } = landingWrite();
  const props = base(settingsWrite);
  const { result, rerender } = renderHook(p => useCardQuickSetting(p), {
    initialProps: props,
  });
  act(() => result.current.popover?.changeSetting(range, "30d"));
  // Nothing said while the old answer is still on screen.
  expect(toast.success).not.toHaveBeenCalled();
  settle(rerender, props, settledAt);
}

describe("a quick setting that asks the card again", () => {
  it("is said, with Undo, once the card's new answer arrives", () => {
    changeAndSettle(REPLACED);
    expect(toasts()).toEqual(["Activity: Date range set to Last 30 days."]);
    expect(toast.success.mock.calls[0]?.[1]).toMatchObject({
      action: { label: "Undo" },
    });
  });

  it("is said as saved but not shown when the re-ask is refused and the old answer stays", () => {
    changeAndSettle(SHOWN);
    expect(toasts()).toEqual([
      "Activity: Date range saved as Last 30 days, but the card could not load it and still shows the earlier data.",
    ]);
  });
});

describe("a quick setting changed at rest", () => {
  it("is written at once, on the change itself", () => {
    const { settingsWrite, write } = landingWrite();
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(settingsWrite, { config: { range: "30d" } }),
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toEqual({ range: "90d" });
  });

  it("is shown in the popover at once, ahead of the write landing", () => {
    // A write still in flight: nothing has landed, and the stored config is unchanged.
    const { settingsWrite } = landingWrite({ write: vi.fn() });
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(settingsWrite, { config: { range: "30d" } }),
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    expect(result.current.popover?.values.range).toBe("90d");
  });

  it("is undone to what the card had just before the latest change, not its first value or its default", () => {
    const { settingsWrite, write } = landingWrite();
    const props = base(settingsWrite, { config: { range: "30d" } });
    const { result, rerender } = renderHook(p => useCardQuickSetting(p), {
      initialProps: props,
    });
    // Two changes, each landing, read back as the stored config and shown by the card: 30d,
    // then 90d, then 7d, the default, which is stored as nothing.
    act(() => result.current.popover?.changeSetting(range, "90d"));
    const second = { ...props, config: { range: "90d" } };
    settle(rerender, second, new Date(2_000));
    act(() => result.current.popover?.changeSetting(range, "7d"));
    const third = { ...props, config: {}, updatedAt: new Date(2_000) };
    settle(rerender, third, new Date(3_000));
    expect(write.mock.calls.map(call => call[0])).toEqual([
      { range: "90d" },
      {},
    ]);

    pressUndo();
    expect(write.mock.calls.at(-1)?.[0]).toEqual({ range: "90d" });
    // The Undo's own change is said too, with no Undo of its own.
    settle(rerender, { ...third, updatedAt: new Date(3_000) }, new Date(4_000));
    expect(toasts().at(-1)).toBe("Activity: Date range set to Last 90 days.");
    expect(toast.success.mock.calls.at(-1)?.[1]).not.toHaveProperty("action");
    // One toast per card, so the earlier change's Undo is replaced rather than left to press.
    const ids = toast.success.mock.calls.map(
      call => (call[1] as { id?: string }).id
    );
    expect(new Set(ids)).toEqual(new Set(["card-change-p1"]));
  });

  it("is undone for that setting alone, keeping a later save of another of the card's settings", () => {
    const { settingsWrite, write } = landingWrite();
    const props = base(settingsWrite, { config: { range: "30d" } });
    const { result, rerender } = renderHook(p => useCardQuickSetting(p), {
      initialProps: props,
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    const changed = { ...props, config: { range: "90d" } };
    settle(rerender, changed, new Date(2_000));
    // The sheet's Done saves Rows after it, while the change's Undo is still on offer.
    rerender({
      ...changed,
      updatedAt: new Date(2_000),
      config: { range: "90d", limit: 9 },
    });

    pressUndo();
    expect(write.mock.calls.at(-1)?.[0]).toEqual({ range: "30d", limit: 9 });
  });

  it("goes back to the stored value, and offers no Undo, when the write does not land", () => {
    const { settingsWrite } = landingWrite({
      write: vi.fn((_config, callbacks: CardSettingsWriteCallbacks) =>
        callbacks.onFailed?.("refused")
      ),
    });
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(settingsWrite, { config: { range: "30d" } }),
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    expect(result.current.popover?.values.range).toBe("30d");
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("a quick setting changed while customising", () => {
  it("is staged in the draft, and nothing is written or offered back", () => {
    const { write } = landingWrite();
    const staged = staging();
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(undefined, {
        isEditing: true,
        staged,
        config: { range: "30d" },
      }),
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    expect(staged.config).toHaveBeenCalledWith({ range: "90d" });
    expect(write).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // The header's own control is a resting one: while customising the popover alone changes it.
    expect(result.current.inline).toBeUndefined();
  });

  it("stages a size through the draft too", () => {
    const staged = staging();
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(undefined, { isEditing: true, staged }),
    });
    act(() => result.current.popover?.changeSize({ w: 6, h: 3 }));
    expect(staged.size).toHaveBeenCalledWith({ w: 6, h: 3 });
  });
});

describe("the card's size, changed at rest", () => {
  it("is written at once, said, and undone back to the size it had", () => {
    const { settingsWrite, resize } = landingWrite();
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(settingsWrite, { size: { w: 4, h: 3 } }),
    });
    expect(result.current.popover?.size?.size).toEqual({ w: 4, h: 3 });
    act(() => result.current.popover?.changeSize({ w: 12, h: 3 }));
    expect(resize.mock.calls[0]?.[0]).toEqual({ w: 12, h: 3 });
    expect(toasts()).toEqual(["Activity: Size set to 12 columns by 3 rows."]);
    pressUndo();
    expect(resize.mock.calls.at(-1)?.[0]).toEqual({ w: 4, h: 3 });
  });

  it("is not offered where the grid gives no size write, nor for a card of one size", () => {
    const { settingsWrite } = landingWrite({ resize: undefined });
    const noResize = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(settingsWrite),
    });
    expect(noResize.result.current.popover?.size).toBeUndefined();

    const fixed = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(landingWrite().settingsWrite, {
        widget: { ...WIDGET, size: gridBounds(12, 3), settings: [] },
      }),
    });
    // Nothing quick and nothing to resize: no popover at all.
    expect(fixed.result.current.popover).toBeUndefined();
  });
});

describe("an Undo offered at rest, once customising begins", () => {
  // Customising hands the card to the draft and takes its at-rest write away, as the grid does.
  const customising = { isEditing: true, settingsWrite: undefined };

  it("is taken down, and writes nothing under the draft when pressed anyway", () => {
    const { settingsWrite, write } = landingWrite();
    const props = base(settingsWrite, { config: { range: "30d" } });
    const { result, rerender } = renderHook(p => useCardQuickSetting(p), {
      initialProps: props,
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    const changed = { ...props, config: { range: "90d" } };
    settle(rerender, changed, new Date(2_000));
    expect(toasts()).toEqual(["Activity: Date range set to Last 90 days."]);

    rerender({ ...changed, updatedAt: new Date(2_000), ...customising });
    expect(toast.dismiss).toHaveBeenCalledWith("card-change-p1");
    pressUndo();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does the same for a size", () => {
    const { settingsWrite, resize } = landingWrite();
    const props = base(settingsWrite, { size: { w: 4, h: 3 } });
    const { result, rerender } = renderHook(p => useCardQuickSetting(p), {
      initialProps: props,
    });
    act(() => result.current.popover?.changeSize({ w: 12, h: 3 }));
    rerender({ ...props, size: { w: 12, h: 3 }, ...customising });
    expect(toast.dismiss).toHaveBeenCalledWith("card-change-p1");
    pressUndo();
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("is not said, nor offered later, when customising begins before the card shows the change", () => {
    const { settingsWrite } = landingWrite();
    const props = base(settingsWrite, { config: { range: "30d" } });
    const { result, rerender } = renderHook(p => useCardQuickSetting(p), {
      initialProps: props,
    });
    act(() => result.current.popover?.changeSetting(range, "90d"));
    // The write landed and the card is still asking again when customising begins.
    rerender({ ...props, config: { range: "90d" }, isFetching: true });
    rerender({ ...props, config: { range: "90d" }, ...customising });
    // Back at rest, with the card's new answer in: the change from before is not said then.
    rerender({
      ...props,
      config: { range: "90d" },
      updatedAt: new Date(2_000),
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("a new collection from the popover", () => {
  const LISTED: DashboardWidget = {
    ...WIDGET,
    settings: [
      { name: "collection", type: "collection", label: "Collection" },
      {
        name: "sort",
        type: "sort",
        of: "collection",
        label: "Sort",
        defaultValue: "-updatedAt",
      },
    ],
  };
  const source = (
    collection: string,
    fields: string[]
  ): PublishedContentSource => ({
    collection,
    label: collection[0]?.toUpperCase() + collection.slice(1),
    lifecycle: false,
    fields: fields.map(name => ({ name, label: name, type: "string" })),
  });

  it("resets the settings that work over it, and is said by the collection's label", () => {
    sources.value = [
      source("posts", ["title", "updatedAt"]),
      source("pages", ["updatedAt"]),
    ];
    const { settingsWrite, write } = landingWrite();
    const { result } = renderHook(p => useCardQuickSetting(p), {
      initialProps: base(settingsWrite, {
        widget: LISTED,
        config: { collection: "posts", sort: "title" },
      }),
    });
    const collection = result.current.popover?.settings[0];
    if (collection?.type !== "collection")
      throw new Error("no Collection drawn");
    expect(result.current.popover?.collections).toEqual([
      { label: "Posts", value: "posts" },
      { label: "Pages", value: "pages" },
    ]);
    act(() => result.current.popover?.changeSetting(collection, "pages"));
    // Pages has no `title`, so the sort goes back to where it starts there: its default.
    expect(write.mock.calls[0]?.[0]).toEqual({ collection: "pages" });
    expect(toast.success.mock.calls[0]?.[0]).toBe(
      "Activity: Collection set to Pages."
    );
  });
});

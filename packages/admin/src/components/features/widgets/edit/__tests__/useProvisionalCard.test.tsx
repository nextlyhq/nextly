/**
 * The card the add panel added as one the reader already has: Save refuses it while it asks what
 * another card of its widget asks, closing its settings unsaved takes it off, and the dashboard's
 * Save leaves it out until it is told apart.
 */
import { act, renderHook } from "@testing-library/react";
import { sizeBounds } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

import type {
  DashboardWidget,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

import type { SaveOptions } from "../useLayoutLifecycle";
import {
  MATCHES_A_CARD,
  useProvisionalCard,
  useSaveLeavingOut,
} from "../useProvisionalCard";

const COUNT: DashboardWidget = {
  id: "core/count",
  title: "Count",
  archetype: "metric",
  size: sizeBounds({ default: { w: 3, h: 2 } }),
  settings: [
    { name: "collection", type: "collection", label: "Collection" },
    {
      name: "show",
      type: "select",
      label: "Under the number",
      defaultValue: "change",
      options: [
        { value: "change", label: "Change" },
        { value: "split", label: "Split" },
      ],
    },
  ],
};
const BY_ID = new Map([[COUNT.id, COUNT]]);

const card = (
  id: string,
  config: Record<string, unknown>,
  over: Partial<WidgetPlacement> = {}
): WidgetPlacement => ({
  id,
  widgetId: COUNT.id,
  w: 3,
  h: 2,
  removed: false,
  config,
  ...over,
});

const PLACEMENTS = [
  card("posts", { collection: "posts" }),
  card("pages", { collection: "pages", show: "split" }),
  // Added as one the reader has: a copy of the Posts card.
  card("new", { collection: "posts" }),
];

function renderProvisional(placements = PLACEMENTS) {
  const discard = vi.fn();
  const view = renderHook(() =>
    useProvisionalCard({
      isEditing: true,
      placements,
      byId: BY_ID,
      sources: undefined,
      discard,
    })
  );
  act(() => view.result.current.start("new"));
  return { ...view, discard };
}

describe("refusal", () => {
  it("refuses settings that ask what another card asks, its defaults counted", () => {
    const { result } = renderProvisional();
    expect([...result.current.ids]).toEqual(["new"]);
    // The Posts card stores no "show": its default, "change", is what it asks.
    expect(
      result.current.refusal("new", { collection: "posts", show: "change" }, "")
    ).toBe(MATCHES_A_CARD);
    expect(
      result.current.refusal("new", { collection: "pages", show: "split" }, "")
    ).toBe(MATCHES_A_CARD);
  });

  it("keeps settings that tell it apart, or a title of its own", () => {
    const { result } = renderProvisional();
    expect(
      result.current.refusal("new", { collection: "posts", show: "split" }, "")
    ).toBeUndefined();
    expect(
      result.current.refusal("new", { collection: "posts" }, "Blog posts")
    ).toBeUndefined();
  });

  it("is not refused by a removed card, or another widget's", () => {
    const { result } = renderProvisional([
      card("posts", { collection: "posts" }, { removed: true }),
      card("other", { collection: "posts" }, { widgetId: "core/breakdown" }),
      card("new", { collection: "posts" }),
    ]);
    expect(
      result.current.refusal("new", { collection: "posts" }, undefined)
    ).toBeUndefined();
  });
});

describe("closing its settings", () => {
  it("takes the card off when they close unsaved", () => {
    const { result, discard } = renderProvisional();
    act(() => result.current.closed("new"));
    expect(discard).toHaveBeenCalledWith("new");
    expect(result.current.ids.size).toBe(0);
  });

  it("keeps the card once they were saved, as they close", () => {
    const { result, discard } = renderProvisional();
    // Save and the close it causes, in one go, as the drawer runs them.
    act(() => {
      result.current.keep("new");
      result.current.closed("new");
    });
    expect(discard).not.toHaveBeenCalled();
    expect(result.current.ids.size).toBe(0);
  });

  it("leaves another card's closing alone", () => {
    const { result, discard } = renderProvisional();
    act(() => result.current.closed("posts"));
    expect(discard).not.toHaveBeenCalled();
    expect([...result.current.ids]).toEqual(["new"]);
  });

  it("keeps each card on probation until its own drawer settles it, one added while another is open", () => {
    const { result, discard } = renderProvisional();
    // A second copy added while the first's drawer is open: opening its drawer closes the first.
    act(() => result.current.start("newer"));
    act(() => result.current.closed("new"));
    expect(discard).toHaveBeenCalledWith("new");
    expect([...result.current.ids]).toEqual(["newer"]);
    act(() => result.current.closed("newer"));
    expect(discard).toHaveBeenLastCalledWith("newer");
  });
});

describe("the dashboard's Save", () => {
  function renderSave(ids: readonly string[]) {
    const save = vi.fn(async (_options?: SaveOptions) => "saved" as const);
    const refusal = vi.fn((_: string, config: Record<string, unknown>) =>
      config.show === "split" ? undefined : MATCHES_A_CARD
    );
    const { result } = renderHook(() =>
      useSaveLeavingOut(save, { ids: new Set(ids), refusal })
    );
    return { save, run: result.current };
  }

  it("saves as asked with no card on probation", async () => {
    const { save, run } = renderSave([]);
    await run({ replaceUnreadable: true });
    expect(save).toHaveBeenCalledWith({ replaceUnreadable: true });
  });

  it("leaves the card out while its settings hold no change, or one that still matches", async () => {
    const { save, run } = renderSave(["new"]);
    await run();
    expect(save).toHaveBeenLastCalledWith({ leaveOut: ["new"] });
    const staged = [
      { placementId: "new", config: { collection: "posts" }, ownTitle: "" },
    ];
    await run({ staged });
    expect(save).toHaveBeenLastCalledWith({ staged, leaveOut: ["new"] });
  });

  it("leaves out every card on probation that is not told apart", async () => {
    const { save, run } = renderSave(["new", "newer"]);
    const staged = [
      {
        placementId: "new",
        config: { collection: "posts", show: "split" },
        ownTitle: "",
      },
    ];
    await run({ staged });
    expect(save).toHaveBeenLastCalledWith({ staged, leaveOut: ["newer"] });
  });

  it("saves the card with a change that tells it apart", async () => {
    const { save, run } = renderSave(["new"]);
    const staged = [
      {
        placementId: "new",
        config: { collection: "posts", show: "split" },
        ownTitle: "",
      },
    ];
    await run({ staged });
    expect(save).toHaveBeenLastCalledWith({ staged });
  });
});

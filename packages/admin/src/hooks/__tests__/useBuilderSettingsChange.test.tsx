/**
 * What an editor does with submitted settings when an unsaved entity's address
 * moves: the move is asked of the server's rule once more, and it can fail or
 * be slow. A failed check moves nothing and keeps the other settings; a second
 * submit while the move is being checked is refused, so the first, finishing
 * later, cannot overwrite it.
 */
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";
import {
  addUnsavedEntity,
  removeUnsavedEntity,
  unsavedEntity,
} from "@admin/lib/builder/unsaved-entities";

const toastError = vi.fn();
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

const checkAgain = vi.fn();
vi.mock(
  "@admin/components/features/schema-builder/new-entity/useAddressCheck",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/schema-builder/new-entity/useAddressCheck")
    >()),
    checkAddressAgain: (...args: unknown[]) => checkAgain(...args),
  })
);

const replaced = vi.fn();
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  replaceTo: (path: string) => replaced(path),
}));

import { useBuilderSettingsChange } from "../useBuilderSettingsChange";

const SETTINGS: BuilderSettingsValues = {
  singularName: "Product",
  slug: "products",
  icon: "Package",
  description: "",
};

function setup() {
  const setSettings = vi.fn();
  const moveAddress = vi.fn();
  const rendered = renderHook(() =>
    useBuilderSettingsChange({
      kind: "collection",
      unsaved: unsavedEntity("collection", "products"),
      settings: SETTINGS,
      setSettings,
      moveAddress,
      busy: false,
      editRoute: address => `/admin/builder/collections/${address}`,
    })
  );
  return { ...rendered, setSettings, moveAddress };
}

beforeEach(() => {
  vi.clearAllMocks();
  addUnsavedEntity({
    kind: "collection",
    address: "products",
    settings: SETTINGS,
    fields: [],
  });
});

afterEach(() => {
  removeUnsavedEntity("collection", "products");
  removeUnsavedEntity("collection", "items");
});

describe("an unsaved entity's address move", () => {
  it("moves nothing, and keeps the other settings, when its final check cannot be asked", async () => {
    checkAgain.mockRejectedValue(new Error("network down"));
    const { result, setSettings, moveAddress } = setup();
    await act(async () => {
      result.current.onSettingsChange({
        ...SETTINGS,
        slug: "items",
        description: "Shop items",
      });
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The new address could not be checked, so it was not moved. The other settings are kept."
      )
    );
    expect(unsavedEntity("collection", "products")).toBeDefined();
    expect(moveAddress).not.toHaveBeenCalled();
    expect(replaced).not.toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledWith({
      ...SETTINGS,
      description: "Shop items",
    });
  });

  it("refuses another change while the move is still being checked, so the move cannot overwrite it", async () => {
    let answer: (refusal: string | null) => void = () => {};
    checkAgain.mockImplementation(
      () => new Promise<string | null>(resolve => (answer = resolve))
    );
    const { result, setSettings } = setup();
    const moving = { ...SETTINGS, slug: "items" };
    act(() => result.current.onSettingsChange(moving));
    act(() =>
      result.current.onSettingsChange({ ...SETTINGS, description: "Later" })
    );
    expect(toastError).toHaveBeenCalledWith(
      "The address is still being moved. Change the settings again once it has."
    );
    expect(setSettings).not.toHaveBeenCalled();

    await act(async () => {
      answer(null);
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(unsavedEntity("collection", "items")).toBeDefined()
    );
    expect(replaced).toHaveBeenCalledWith("/admin/builder/collections/items");
  });

  it("gives up on a final check that never answers, after the live check's wait, and takes the next change", async () => {
    vi.useFakeTimers();
    try {
      checkAgain.mockImplementation(() => new Promise<string | null>(() => {}));
      const { result, setSettings } = setup();
      act(() =>
        result.current.onSettingsChange({
          ...SETTINGS,
          slug: "items",
          description: "Shop items",
        })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(toastError).toHaveBeenCalledWith(
        "The new address could not be checked, so it was not moved. The other settings are kept."
      );
      expect(unsavedEntity("collection", "items")).toBeUndefined();
      expect(setSettings).toHaveBeenLastCalledWith({
        ...SETTINGS,
        description: "Shop items",
      });

      // The move is over, so a later change is taken, not refused as still moving.
      act(() =>
        result.current.onSettingsChange({ ...SETTINGS, description: "Later" })
      );
      expect(setSettings).toHaveBeenLastCalledWith({
        ...SETTINGS,
        description: "Later",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

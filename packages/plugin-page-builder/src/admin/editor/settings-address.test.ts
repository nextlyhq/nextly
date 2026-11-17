// @vitest-environment jsdom

/**
 * The one read of a page's saved address, which Settings and the right panel
 * share: asked only for a saved page, and asked again after each save.
 *
 * @module admin/editor/settings-address.test
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refetch = vi.fn(() => Promise.resolve());
const asked: { path: string; enabled?: boolean }[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (args: { path: string; enabled?: boolean }) => {
    asked.push(args);
    return {
      data: args.enabled === false ? undefined : { path: "/pricing" },
      error: null,
      refetch,
    };
  },
}));

import { useSavedAddress, type SettingsAddress } from "./settings-address";

const saved = (savedRevision: number): SettingsAddress => ({
  page: { collection: "pages", id: "p1" },
  slugChanged: false,
  savedRevision,
});

afterEach(() => {
  refetch.mockClear();
  asked.length = 0;
});

describe("the saved address read", () => {
  it("answers the saved address of a saved page", () => {
    const { result } = renderHook(() => useSavedAddress(saved(0), true));
    expect(result.current.data?.path).toBe("/pricing");
    expect(asked.at(-1)?.enabled).toBe(true);
  });

  it("asks nothing for a page never saved, or while not shown", () => {
    renderHook(() => useSavedAddress(null, true));
    expect(asked.at(-1)?.enabled).toBe(false);
    renderHook(() => useSavedAddress(saved(0), false));
    expect(asked.at(-1)?.enabled).toBe(false);
  });

  it("reads again after each save, and not on other renders", () => {
    const { rerender } = renderHook(
      ({ revision }: { revision: number }) =>
        useSavedAddress(saved(revision), true),
      { initialProps: { revision: 0 } }
    );
    rerender({ revision: 0 });
    expect(refetch).not.toHaveBeenCalled();
    rerender({ revision: 1 });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

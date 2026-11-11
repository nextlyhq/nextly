/**
 * The outline reads every field group it may show in one request: a field
 * group used inside another needs no second round, and no field group is
 * asked for on its own.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createTestQueryClient,
  renderHook,
  waitFor,
} from "@admin/__tests__/utils";

import { useOutlineFieldGroups } from "../useOutlineFieldGroups";

const list = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/fieldGroupApi", () => ({
  fieldGroupApi: { list, get },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useOutlineFieldGroups", () => {
  it("reads every field group, a nested one included, in one request", async () => {
    list.mockResolvedValue([
      {
        slug: "seo",
        label: "SEO",
        fields: [{ name: "social", type: "component", component: "social" }],
      },
      { slug: "social", label: "Social", fields: [] },
    ]);
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("loaded"));
    expect([...result.current.fieldGroups.keys()]).toEqual(["seo", "social"]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("carries whether each field group translates its fields", async () => {
    list.mockResolvedValue([
      { slug: "seo", label: "SEO", fields: [], localized: true },
      { slug: "social", label: "Social", fields: [] },
    ]);
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("loaded"));
    expect(result.current.fieldGroups.get("seo")?.localized).toBe(true);
    expect(result.current.fieldGroups.get("social")?.localized).toBe(false);
  });

  it("says it could not read them, rather than looking like it is still loading", async () => {
    list.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useOutlineFieldGroups(), { wrapper });
    await waitFor(() => expect(result.current.load).toBe("failed"));
    expect(result.current.fieldGroups.size).toBe(0);
  });
});

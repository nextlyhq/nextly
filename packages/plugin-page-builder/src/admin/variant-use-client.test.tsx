// @vitest-environment jsdom
/**
 * The count the variant delete dialog shows, asked of the plugin's route.
 *
 * The property a plausible client gets wrong: answering a failed request as
 * zero placements, which the dialog would say as "Nothing uses this
 * variant" about one that may be used everywhere. A failure must reach the
 * dialog as a count that could not be made.
 *
 * @module admin/variant-use-client.test
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRouteMutation: vi.fn(),
}));

import { usePluginRouteMutation } from "@nextlyhq/plugin-sdk/admin";

import { useVariantUse } from "./variant-use-client";

const mutation = vi.mocked(usePluginRouteMutation);
const write = vi.fn();

beforeEach(() => {
  write.mockReset();
  mutation.mockReturnValue({
    write,
    pending: false,
    error: null,
  } as unknown as ReturnType<typeof usePluginRouteMutation>);
});

describe("the variant-use count", () => {
  it("is asked for the component and the variant", async () => {
    write.mockResolvedValue({ placements: 2, documents: 1, complete: true });
    const { result } = renderHook(() => useVariantUse("hero"));

    await expect(result.current?.countUse?.("v-1")).resolves.toEqual({
      placements: 2,
      documents: 1,
      complete: true,
    });
    expect(write).toHaveBeenCalledWith({
      componentId: "hero",
      variantId: "v-1",
    });
  });

  it("fails rather than answering none when the route fails", async () => {
    write.mockResolvedValue(undefined);
    const { result } = renderHook(() => useVariantUse("hero"));

    await expect(result.current?.countUse?.("v-1")).rejects.toThrow();
  });

  it("is not offered for a component with no row", () => {
    const { result } = renderHook(() => useVariantUse(undefined));
    expect(result.current).toBeUndefined();
  });
});

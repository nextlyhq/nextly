/**
 * A destructive act must not fire before the thing it destroys has loaded.
 *
 * Hooks cannot be called conditionally, so this one is mounted while the
 * endpoint document is still in flight — a window in which its name is not
 * known. The handler this was extracted from returned early on exactly that
 * (`if (!webhook) return;`), and an extraction that drops a guard leaves a
 * delete whose only remaining protection is that nothing currently calls it.
 *
 * Today the confirmation dialog stands in the way, which is why this cannot be
 * observed through the page — and is precisely why the guard belongs to the
 * hook rather than to whichever caller remembers it.
 */
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteSpy } = vi.hoisted(() => ({ deleteSpy: vi.fn() }));

vi.mock("@admin/hooks/queries/useWebhooks", () => ({
  useDeleteWebhook: () => ({ mutate: deleteSpy, isPending: false }),
}));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

const { useWebhookDeletion } = await import("./useWebhookDeletion");

beforeEach(() => {
  deleteSpy.mockReset();
});

describe("deleting a webhook endpoint", () => {
  it("refuses while the endpoint has not loaded", () => {
    const { result } = renderHook(() => useWebhookDeletion("w1", null));

    act(() => {
      result.current.confirm();
    });

    // The outcome, not the guard: no delete was ISSUED. Asserting the early
    // return itself would pass against a hook that returned and deleted anyway.
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("deletes once the endpoint is known", () => {
    const { result } = renderHook(() => useWebhookDeletion("w1", "Order sync"));

    act(() => {
      result.current.confirm();
    });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy.mock.calls[0][0]).toBe("w1");
  });
});

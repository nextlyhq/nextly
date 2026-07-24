import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { DeliveriesContent } from "../index";

const {
  useWebhook,
  useDeliveries,
  useRunDrain,
  drainMutate,
  canFor,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  useWebhook: vi.fn(),
  useDeliveries: vi.fn(),
  useRunDrain: vi.fn(),
  drainMutate: vi.fn(),
  canFor: vi.fn((_slug: string) => true),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@admin/hooks/queries", () => ({
  useWebhook: (id: string) => useWebhook(id),
  useDeliveries: (id: string, params: unknown, opts: unknown) =>
    useDeliveries(id, params, opts),
  useRunDrain: () => useRunDrain(),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));
vi.mock("@admin/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@admin/components/ui")>(
    "@admin/components/ui"
  );
  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

const EMPTY_LIST = {
  data: { items: [], meta: { total: 0, totalPages: 1 } },
  isLoading: false,
  isError: false,
};

describe("Deliveries page — Process queue now", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canFor.mockImplementation(() => true);
    useWebhook.mockReturnValue({ data: { id: "wh_1", name: "Orders" } });
    useDeliveries.mockReturnValue(EMPTY_LIST);
    useRunDrain.mockReturnValue({ mutate: drainMutate, isPending: false });
  });

  it("toasts a summary of the drain result on success", async () => {
    drainMutate.mockImplementation((_arg, opts) => {
      opts.onSuccess({
        rounds: 1,
        eventsProcessed: 2,
        deliveriesCreated: 2,
        attempted: 2,
        delivered: 1,
        retried: 1,
        failed: 0,
        abandoned: 0,
        pruned: { events: 0, deliveries: 0 },
      });
    });

    render(<DeliveriesContent id="wh_1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /process queue now/i })
    );

    expect(drainMutate).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith(
      "Queue processed",
      expect.objectContaining({
        description: expect.stringContaining("2 attempted"),
      })
    );
  });

  it("hides the drain button for a read-only user", () => {
    canFor.mockImplementation((slug: string) => slug === "read-webhooks");
    render(<DeliveriesContent id="wh_1" />);
    expect(
      screen.queryByRole("button", { name: /process queue now/i })
    ).not.toBeInTheDocument();
  });
});

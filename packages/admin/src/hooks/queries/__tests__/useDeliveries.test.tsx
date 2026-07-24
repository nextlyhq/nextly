import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSpy, getSpy, redeliverSpy, drainSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
  getSpy: vi.fn(),
  redeliverSpy: vi.fn(),
  drainSpy: vi.fn(),
}));

vi.mock("@admin/services/deliveryApi", () => ({
  deliveryApi: {
    listDeliveries: listSpy,
    getDelivery: getSpy,
    redeliver: redeliverSpy,
    runDrain: drainSpy,
  },
}));

import { useDeliveries, useDelivery, useRunDrain } from "../useDeliveries";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDeliveries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the endpoint id and params straight through to the service", async () => {
    listSpy.mockResolvedValue({ items: [], meta: { total: 0 } });
    const params = { page: 2, limit: 25, status: "failed" as const };

    const { result } = renderHook(() => useDeliveries("wh_1", params), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listSpy).toHaveBeenCalledWith("wh_1", params);
  });

  it("does not fetch while disabled", () => {
    renderHook(() => useDeliveries("wh_1", { page: 1 }, { enabled: false }), {
      wrapper,
    });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("does not fetch without an endpoint id", () => {
    renderHook(() => useDeliveries("", { page: 1 }), { wrapper });
    expect(listSpy).not.toHaveBeenCalled();
  });
});

describe("useDelivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads one delivery by id", async () => {
    getSpy.mockResolvedValue({ id: "dlv_1" });
    const { result } = renderHook(() => useDelivery("wh_1", "dlv_1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledWith("wh_1", "dlv_1");
  });

  it("stays idle when a delivery id is missing", () => {
    renderHook(() => useDelivery("wh_1", ""), { wrapper });
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("useRunDrain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes the drain service on mutate", async () => {
    drainSpy.mockResolvedValue({ rounds: 1, delivered: 0 });
    const { result } = renderHook(() => useRunDrain(), { wrapper });

    result.current.mutate();
    await waitFor(() => expect(drainSpy).toHaveBeenCalledTimes(1));
  });
});

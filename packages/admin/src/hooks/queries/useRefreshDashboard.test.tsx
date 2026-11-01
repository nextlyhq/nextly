/**
 * The dashboard refresh a widget asks for after its own write: every card's
 * batch and the header summary go stale, and nothing else does.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { DASHBOARD_SUMMARY_KEY } from "./useDashboardSummary";
import { useRefreshDashboard } from "./useRefreshDashboard";
import { WIDGET_QUERIES_KEY } from "./widget-queries-key";

describe("useRefreshDashboard", () => {
  it("asks every card and the header summary again, and leaves other reads alone", () => {
    const client = new QueryClient();
    const batch = [...WIDGET_QUERIES_KEY, "batch-1"];
    const layout = ["dashboard", "layout"];
    for (const key of [batch, DASHBOARD_SUMMARY_KEY, layout]) {
      client.setQueryData(key, { answered: true });
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRefreshDashboard(), { wrapper });

    act(() => result.current());

    const stale = (key: readonly unknown[]) =>
      client.getQueryState(key)?.isInvalidated;
    expect(stale(batch)).toBe(true);
    expect(stale(DASHBOARD_SUMMARY_KEY)).toBe(true);
    // The control: a read it does not name keeps its answer.
    expect(stale(layout)).toBe(false);
  });
});

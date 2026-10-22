/**
 * The key form's summary follows grants that change while the form is open.
 *
 * A read-only or full-access key follows its creator's permissions, and a
 * role-based one its role, so either can change between the form opening and
 * the key being created. Focus refetching is off across the admin and nothing
 * on this screen invalidates the summary, so without asking again the form
 * would show the old answer while the key it creates gets the new one.
 *
 * Asserted as the OUTCOME, what the hook asks and reports as the clock moves,
 * rather than by reading the interval back: no ask before the interval, one
 * at it, so a shorter or a longer interval fails, and the new answer shown.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAbilitiesSpy } = vi.hoisted(() => ({
  fetchAbilitiesSpy: vi.fn(),
}));

vi.mock("@admin/services/apiKeyApi", () => ({
  fetchApiKeyAbilities: fetchAbilitiesSpy,
  fetchApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  updateApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

import { useApiKeyAbilities } from "../useApiKeys";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** How often the summary asks again while the form is open. */
const REFRESH_EVERY_MS = 30_000;
/** Long enough for an answer to reach React, and far shorter than that. */
const SETTLE_MS = 1_000;

beforeEach(() => {
  vi.clearAllMocks();
  // The clock moves only when the test moves it, so the moment of each ask is
  // the test's to choose: a clock that also ran on its own would let a
  // slightly longer interval land inside the window.
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** Move the clock and let what it set off settle. */
function elapse(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the key form's summary held open", () => {
  it("asks again every half minute, and shows the new answer", async () => {
    fetchAbilitiesSpy
      .mockResolvedValueOnce([
        { slug: "read-posts", action: "read", resource: "posts" },
      ])
      .mockResolvedValue([]);

    const { result } = renderHook(
      () => useApiKeyAbilities({ tokenType: "read-only" }),
      { wrapper }
    );
    await elapse(0);
    expect(fetchAbilitiesSpy).toHaveBeenCalledTimes(1);
    expect(result.current.data).toHaveLength(1);

    // Not before the interval: a shorter one would have asked by now.
    await elapse(REFRESH_EVERY_MS - 1);
    expect(fetchAbilitiesSpy).toHaveBeenCalledTimes(1);
    expect(result.current.data).toHaveLength(1);

    // At it: a longer one would not have asked yet.
    await elapse(1);
    expect(fetchAbilitiesSpy).toHaveBeenCalledTimes(2);
    // The answer reaches React a moment later, through timers of the query's
    // own; a moment well short of the next ask.
    await elapse(SETTLE_MS);
    expect(fetchAbilitiesSpy).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual([]);

    // And again a whole interval after the last, not only once.
    await elapse(REFRESH_EVERY_MS - SETTLE_MS - 1);
    expect(fetchAbilitiesSpy).toHaveBeenCalledTimes(2);
    await elapse(1);
    expect(fetchAbilitiesSpy).toHaveBeenCalledTimes(3);
  });
});

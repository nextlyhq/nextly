/**
 * The key form's summary follows grants that change while the form is open.
 *
 * A read-only or full-access key follows its creator's permissions, and a
 * role-based one its role, so either can change between the form opening and
 * the key being created. Focus refetching is off across the admin and nothing
 * on this screen invalidates the summary, so without asking again the form
 * would show the old answer while the key it creates gets the new one.
 *
 * Asserted as the OUTCOME, what the hook reports after the server's answer
 * changes underneath it, rather than by reading the interval back.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("the key form's summary held open", () => {
  it("shows the new answer once the grants it describes have changed", async () => {
    fetchAbilitiesSpy
      .mockResolvedValueOnce([
        { slug: "read-posts", action: "read", resource: "posts" },
      ])
      .mockResolvedValue([]);

    const { result } = renderHook(
      () => useApiKeyAbilities({ tokenType: "read-only" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    await vi.advanceTimersByTimeAsync(60_000);

    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});

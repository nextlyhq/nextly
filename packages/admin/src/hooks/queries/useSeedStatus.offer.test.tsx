/**
 * Whether the dashboard offers sample content, from the sample-content route's
 * answer to the probe through to the state the card draws.
 *
 * `useSeedStatus.test.tsx` mocks the whole service, so it proves the state
 * machine for a probe answer it is handed and nothing about which answers
 * become an offer. These keep the real service and answer its `fetch`, so a
 * probe that turned a refusal into "available" fails here as an offer drawn.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSeedStatus } from "./useSeedStatus";

const TEMPLATE_HEADERS = {
  "x-nextly-seed-template": "blog",
  "x-nextly-seed-template-label": "Blog",
};

/** Answers the probe with `probe`, and the site's answer as unanswered. */
function answerProbeWith(probe: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/admin/api/seed") return probe();
    if (url === "/admin/api/meta/seed-status") {
      return new Response(
        JSON.stringify({ completedAt: null, skippedAt: null }),
        { status: 200 }
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSeedStatus — which probe answers become an offer", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("offers sample content when the route lets this person load it", async () => {
    answerProbeWith(
      () => new Response(null, { status: 200, headers: TEMPLATE_HEADERS })
    );
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("idle"));
    expect(result.current.status).toEqual({
      kind: "idle",
      template: { slug: "blog", label: "Blog" },
    });
  });

  it.each([
    [401, "no session"],
    [403, "a person the route refuses"],
    [404, "no sample-content route"],
    [500, "the route failing"],
    [503, "the server still starting"],
  ])(
    "offers nothing when the route answers %i (%s)",
    async (status, _label) => {
      const fetchMock = answerProbeWith(
        () => new Response(null, { status, headers: TEMPLATE_HEADERS })
      );
      const { result } = renderHook(() => useSeedStatus(), { wrapper });
      await waitFor(() => expect(result.current.status.kind).toBe("hidden"));
      // The probe was asked, so "hidden" is its answer and not a probe that
      // never ran.
      expect(fetchMock).toHaveBeenCalledWith(
        "/admin/api/seed",
        expect.objectContaining({ method: "HEAD" })
      );
    }
  );

  it("offers nothing when the route cannot be reached", async () => {
    answerProbeWith(() => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useSeedStatus(), { wrapper });
    await waitFor(() => expect(result.current.status.kind).toBe("hidden"));
  });
});

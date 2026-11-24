/**
 * The titles read for "Titles in": the rows on screen, by id, in the chosen language with no
 * fallback, so a title the language does not have is not filled in with the default's; only
 * what that read returned is offered as a title in that language; a refused read says so, asked
 * once, while a failure another try may answer is asked again; and
 * nothing is read while the default language is shown.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";

import { useTitlesInLanguage } from "../useTitlesInLanguage";

const { find } = vi.hoisted(() => ({ find: vi.fn() }));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const original =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...original, entryApi: { ...original.entryApi, find } };
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

/** The server's refusal of a read in a language this reader may not see. */
const refusal = () =>
  Object.assign(new Error("You can't see posts in Spanish."), { status: 403 });

/** A client whose queries retry `retry` times by default, with no wait between tries. */
function wrapperRetrying(retry = 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 0, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ARGS = {
  collectionSlug: "posts",
  locale: "es",
  titleField: "title",
  ids: ["p1", "p2", "p3"],
  enabled: true,
};

describe("useTitlesInLanguage", () => {
  beforeEach(() => {
    find.mockReset();
  });

  it("reads the rows on screen in that language, with no fallback and no relations", async () => {
    find.mockResolvedValue({ items: [], meta: {} });
    renderHook(() => useTitlesInLanguage(ARGS), { wrapper });
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    expect(find).toHaveBeenCalledWith("posts", {
      page: 1,
      limit: 3,
      status: "all",
      where: { id: { in: ["p1", "p2", "p3"] } },
      locale: "es",
      fallbackLocale: "none",
      depth: 0,
    });
  });

  it("offers each returned row's title by id, and nothing for a row the read did not return", async () => {
    // The server returned p1 translated and p2 with no Spanish title; p3, which this reader may
    // not read in Spanish, it did not return at all.
    find.mockResolvedValue({
      items: [
        { id: "p1", title: "Hola" },
        { id: "p2", title: null },
      ],
      meta: {},
    });
    const { result } = renderHook(() => useTitlesInLanguage(ARGS), {
      wrapper,
    });
    await waitFor(() => expect(result.current.titles).toBeDefined());
    expect(result.current.titles?.get("p1")).toBe("Hola");
    expect(result.current.titles?.get("p2")).toBeNull();
    expect(result.current.titles?.has("p3")).toBe(false);
    expect(result.current.failed).toBe(false);
  });

  it("says the read failed when the server refuses it, and offers no titles", async () => {
    find.mockRejectedValue(refusal());
    // A client that retries by default, as an application's may: the refusal is still asked once.
    const { result } = renderHook(() => useTitlesInLanguage(ARGS), {
      wrapper: wrapperRetrying(),
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.titles?.size).toBe(0);
    // Asked once: a refusal is the answer for this reader and language.
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure another try may answer, and offers what it returns", async () => {
    // A client that never retries by default: the read retries on its own rule.
    find
      .mockRejectedValueOnce(
        Object.assign(new Error("The server is unavailable."), { status: 503 })
      )
      .mockResolvedValueOnce({
        items: [{ id: "p1", title: "Hola" }],
        meta: {},
      });
    const { result } = renderHook(() => useTitlesInLanguage(ARGS), {
      wrapper: wrapperRetrying(0),
    });
    await waitFor(() => expect(result.current.titles?.get("p1")).toBe("Hola"));
    expect(result.current.failed).toBe(false);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("offers no titles once a later read fails, though an earlier one answered", async () => {
    // The query keeps the earlier answer through a failed read again: its titles may be ones
    // this reader may no longer read in that language, so none is offered.
    const client = createTestQueryClient();
    find.mockResolvedValueOnce({
      items: [{ id: "p1", title: "Hola" }],
      meta: {},
    });
    const { result } = renderHook(() => useTitlesInLanguage(ARGS), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.titles?.get("p1")).toBe("Hola"));

    find.mockRejectedValueOnce(refusal());
    await act(() => client.refetchQueries());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.titles?.size).toBe(0);
  });

  it("reads nothing while the default language is shown, or with no rows on screen", () => {
    renderHook(() => useTitlesInLanguage({ ...ARGS, enabled: false }), {
      wrapper,
    });
    renderHook(() => useTitlesInLanguage({ ...ARGS, ids: [] }), { wrapper });
    expect(find).not.toHaveBeenCalled();
  });
});

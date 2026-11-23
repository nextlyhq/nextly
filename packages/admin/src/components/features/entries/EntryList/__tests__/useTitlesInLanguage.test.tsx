/**
 * The titles read for "Titles in": the rows on screen, by id, in the chosen language with no
 * fallback, so a title the language does not have is not filled in with the default's; only
 * what that read returned is offered as a title in that language; a refused read says so; and
 * nothing is read while the default language is shown.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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
    find.mockRejectedValue(new Error("You can't see posts in Spanish."));
    const { result } = renderHook(() => useTitlesInLanguage(ARGS), {
      wrapper,
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.titles).toBeUndefined();
    // Asked once: a refusal is the answer for this reader and language.
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("reads nothing while the default language is shown, or with no rows on screen", () => {
    renderHook(() => useTitlesInLanguage({ ...ARGS, enabled: false }), {
      wrapper,
    });
    renderHook(() => useTitlesInLanguage({ ...ARGS, ids: [] }), { wrapper });
    expect(find).not.toHaveBeenCalled();
  });
});

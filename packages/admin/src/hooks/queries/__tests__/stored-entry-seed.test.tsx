/**
 * The edit page's two reads of an entry, made in one request.
 *
 * The populated read asks for the stored read beside it (`?stored=1`) and the
 * stored read takes that answer, on open, after a save's invalidation and on
 * a reload; both stay their own queries under their own keys. Driven through
 * the real hooks and a real query client, counting the requests sent.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get },
}));

import { entryKeys } from "@admin/services/entryApi";

import { storedEntryKey } from "../stored-entry-seed";
import { useEntry } from "../useEntry";
import { useStoredEntry } from "../useStoredReferences";

type Doc = Record<string, unknown>;

const populated = { id: "e1", updatedAt: "v1", author: { id: "a", name: "Ana" } };
const stored = { id: "e1", updatedAt: "v1", author: "a", reviewer: "hidden" };

/** Answers like the server: `_stored` beside the entry when asked for it. */
function server({ carries = true } = {}) {
  get.mockImplementation((url: string) => {
    const query = new URL(url, "http://x").searchParams;
    if (query.get("depth") === "0") return Promise.resolve({ ...stored });
    return Promise.resolve(
      query.get("stored") === "1" && carries
        ? { ...populated, _stored: { ...stored } }
        : { ...populated }
    );
  });
}

function clientAndWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const scope = { collectionSlug: "pages", entryId: "e1", draft: true };

/** The page's two reads, in the page's order or the other. */
function usePair(storedFirst = false) {
  if (storedFirst) {
    const s = useStoredEntry(scope);
    const p = useEntry<Doc>({ ...scope, depth: 2, carriesStored: true });
    return { populated: p, stored: s };
  }
  const p = useEntry<Doc>({ ...scope, depth: 2, carriesStored: true });
  const s = useStoredEntry(scope);
  return { populated: p, stored: s };
}

const urls = () => get.mock.calls.map(call => String(call[0]));

describe("the edit page's entry reads", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it.each([false, true])(
    "open on one request, the stored read taken from the populated read's answer (stored hook first: %s)",
    async storedFirst => {
      server();
      const { wrapper } = clientAndWrapper();
      const { result } = renderHook(() => usePair(storedFirst), { wrapper });
      await waitFor(() => {
        expect(result.current.populated.data).toBeDefined();
        expect(result.current.stored.data).toBeDefined();
      });
      expect(urls()).toHaveLength(1);
      expect(urls()[0]).toContain("stored=1");
      expect(urls()[0]).toContain("depth=2");
      // Cached as a populated read alone answers it.
      expect(result.current.populated.data).toEqual(populated);
      expect(result.current.populated.data).not.toHaveProperty("_stored");
      expect(result.current.stored.data).toEqual(stored);
    }
  );

  it("reads both again in one request after a save's invalidation", async () => {
    server();
    const { client, wrapper } = clientAndWrapper();
    const { result } = renderHook(() => usePair(), { wrapper });
    await waitFor(() => expect(result.current.stored.data).toBeDefined());
    get.mockClear();

    await act(() =>
      client.invalidateQueries({ queryKey: entryKeys.detail("pages", "e1") })
    );
    await waitFor(() => {
      expect(result.current.populated.isFetching).toBe(false);
      expect(result.current.stored.isFetching).toBe(false);
    });
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain("stored=1");
  });

  it("reads both again in one request on a reload", async () => {
    server();
    const { wrapper } = clientAndWrapper();
    const { result } = renderHook(() => usePair(), { wrapper });
    await waitFor(() => expect(result.current.stored.data).toBeDefined());
    get.mockClear();

    await act(() =>
      Promise.all([
        result.current.populated.refetch({ cancelRefetch: true }),
        result.current.stored.refetch({ cancelRefetch: true }),
      ])
    );
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain("stored=1");
  });

  it("reads depth 0 itself when the answer carries no stored read", async () => {
    server({ carries: false });
    const { wrapper } = clientAndWrapper();
    const { result } = renderHook(() => usePair(), { wrapper });
    await waitFor(() => expect(result.current.stored.data).toBeDefined());
    expect(urls()).toHaveLength(2);
    expect(urls()[1]).toContain("depth=0");
    expect(result.current.stored.data).toEqual(stored);
  });

  it("reads depth 0 itself when the populated read fails", async () => {
    get.mockImplementation((url: string) =>
      url.includes("depth=0")
        ? Promise.resolve({ ...stored })
        : Promise.reject(new Error("unreachable"))
    );
    const { wrapper } = clientAndWrapper();
    const { result } = renderHook(() => usePair(), { wrapper });
    await waitFor(() => {
      expect(result.current.populated.error).not.toBeNull();
      expect(result.current.stored.data).toEqual(stored);
    });
    expect(urls().filter(url => url.includes("depth=0"))).toHaveLength(1);
  });

  it("reads depth 0 alone when only the stored read asks", async () => {
    server();
    const { wrapper } = clientAndWrapper();
    const { result } = renderHook(() => usePair(), { wrapper });
    await waitFor(() => expect(result.current.stored.data).toBeDefined());
    get.mockClear();

    await act(() => result.current.stored.refetch());
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain("depth=0");
  });

  it("hands the stored read the answer of a populated read made on its own", async () => {
    server();
    const { client, wrapper } = clientAndWrapper();
    const { result } = renderHook(() => usePair(), { wrapper });
    await waitFor(() => expect(result.current.stored.data).toBeDefined());
    const next = { ...stored, updatedAt: "v2" };
    get.mockImplementation(() =>
      Promise.resolve({ ...populated, updatedAt: "v2", _stored: next })
    );

    await act(() => result.current.populated.refetch());
    await waitFor(() =>
      expect(
        client.getQueryData(
          storedEntryKey("pages", "e1", { draft: true })
        )
      ).toEqual(next)
    );
  });
});

/**
 * When the editor's document is merged with its stored links.
 *
 * The populated read and the depth-0 read are separate requests, and the form
 * resets whenever the document it is handed changes. A merge of two reads that
 * describe different moments would put a link back that a save just removed,
 * and the form would be reset to it. These cases drive the two reads through
 * the states a save and a refetch produce and assert what the editor is handed.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/** The keys of the saves in flight, matched by prefix as React Query does. */
const { mutating } = vi.hoisted(() => ({
  mutating: { keys: [] as unknown[][] },
}));

vi.mock("@tanstack/react-query", async importOriginal => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useIsMutating: ({ mutationKey }: { mutationKey: unknown[] }) =>
    mutating.keys.filter(key =>
      mutationKey.every((part, index) => key[index] === part)
    ).length,
}));

import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

import { useWithStoredReferences } from "../useStoredReferences";

type Doc = Record<string, unknown>;

/** The document's own query key, as the page passes it. */
const DOCUMENT = ["entries", "detail", "posts", "e"];

const FIELDS = [
  { name: "pages", type: "relationship", relationTo: "pages", hasMany: true },
] as never[];

const pageA = { id: "a", title: "Page A" };

/** A query result as the hook reads one. */
function read(
  data: Doc | undefined,
  { isFetching = false, refetch = vi.fn() } = {}
) {
  return {
    data,
    isFetching,
    error: null,
    refetch,
  } as never;
}

const populatedV1 = { id: "e", updatedAt: "v1", pages: [pageA] };
const storedV1 = { id: "e", updatedAt: "v1", pages: ["a", "hidden"] };

describe("useWithStoredReferences", () => {
  beforeEach(() => {
    mutating.keys = [];
  });

  it("is loading until both reads have arrived, then hands over the merge", () => {
    const { result, rerender } = renderHook(
      (props: { stored: Doc | undefined }) =>
        useWithStoredReferences({
          fields: FIELDS,
          documentKey: DOCUMENT,
          populated: read(populatedV1),
          stored: read(props.stored),
          scope: "e",
        }),
      { initialProps: { stored: undefined as Doc | undefined } }
    );
    expect(result.current).toMatchObject({
      document: undefined,
      isLoading: true,
    });

    rerender({ stored: storedV1 });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.document?.pages).toEqual([
      pageA,
      { id: "hidden", [RESTRICTED_REFERENCE]: true },
    ]);
  });

  it("keeps the last merge while a save is in flight", () => {
    // A save writes its payload into the populated read at once, before the
    // server answers: same version, and without the link the editor removed,
    // while the depth-0 read still lists it.
    const optimistic = { id: "e", updatedAt: "v1", pages: [] };
    const { result, rerender } = renderHook(
      (props: { populated: never }) =>
        useWithStoredReferences({
          fields: FIELDS,
          documentKey: DOCUMENT,
          populated: props.populated,
          stored: read(storedV1),
          scope: "e",
        }),
      { initialProps: { populated: read(populatedV1) } }
    );
    const first = result.current.document;

    mutating.keys = [[...DOCUMENT, "update"]];
    rerender({ populated: read(optimistic) });
    expect(result.current.document).toBe(first);
  });

  it("is not held back by a save of another document", () => {
    mutating.keys = [["entries", "detail", "posts", "other", "update"]];
    const { result } = renderHook(() =>
      useWithStoredReferences({
        fields: FIELDS,
        documentKey: DOCUMENT,
        populated: read(populatedV1),
        stored: read(storedV1),
        scope: "e",
      })
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.document).toBeDefined();
  });

  it("counts retries afresh in another language", () => {
    const refetch = vi.fn();
    const apart = (scope: string) => ({
      scope,
      populated: read(
        { ...populatedV1, updatedAt: "v2" },
        { refetch }
      ) as never,
      stored: read(storedV1, { refetch }) as never,
    });
    const settling = (scope: string) => ({
      scope,
      populated: read(undefined, { isFetching: true }) as never,
      stored: read(undefined, { isFetching: true }) as never,
    });
    const { result, rerender } = renderHook(
      (props: { scope: string; populated: never; stored: never }) =>
        useWithStoredReferences({
          fields: FIELDS,
          documentKey: DOCUMENT,
          ...props,
        }),
      { initialProps: apart("e:en") }
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      rerender(settling("e:en"));
      rerender(apart("e:en"));
    }
    expect(result.current.error?.message).toMatch(/kept changing/);

    refetch.mockClear();
    rerender(apart("e:es"));
    expect(result.current.error).toBeNull();
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the last merge while either read is refetching, then merges the fresh pair", () => {
    const populatedV2 = { id: "e", updatedAt: "v2", pages: [pageA] };
    const storedV2 = { id: "e", updatedAt: "v2", pages: ["a"] };
    const { result, rerender } = renderHook(
      (props: { populated: never; stored: never }) =>
        useWithStoredReferences({
          fields: FIELDS,
          documentKey: DOCUMENT,
          ...props,
          scope: "e",
        }),
      {
        initialProps: {
          populated: read(populatedV1),
          stored: read(storedV1),
        },
      }
    );
    const first = result.current.document;

    // A read that changed while the other is still being fetched: the two
    // agree on the version, but one of them is about to be replaced.
    rerender({
      populated: read({ ...populatedV1, pages: [] }),
      stored: read(storedV1, { isFetching: true }),
    });
    expect(result.current.document).toBe(first);
    rerender({
      populated: read({ ...populatedV1, pages: [] }, { isFetching: true }),
      stored: read({ ...storedV1 }),
    });
    expect(result.current.document).toBe(first);

    rerender({ populated: read(populatedV2), stored: read(storedV2) });
    expect(result.current.document?.pages).toEqual([pageA]);
  });

  it("never merges reads of two versions, and reads both again", () => {
    const refetchPopulated = vi.fn();
    const refetchStored = vi.fn();
    const { result } = renderHook(() =>
      useWithStoredReferences({
        fields: FIELDS,
        documentKey: DOCUMENT,
        populated: read(
          { ...populatedV1, updatedAt: "v2" },
          { refetch: refetchPopulated }
        ),
        stored: read(storedV1, { refetch: refetchStored }),
        scope: "e",
      })
    );
    expect(result.current.document).toBeUndefined();
    expect(refetchPopulated).toHaveBeenCalledTimes(1);
    expect(refetchStored).toHaveBeenCalledTimes(1);
  });

  it("stops handing over an earlier merge once reads stay apart after every retry", () => {
    // A save, or someone else's, leaves the two reads on different versions
    // and refetching never brings them together. The earlier merge would be
    // written back over the newer document, so the editor is told instead.
    const { result, rerender } = renderHook(
      (props: { populated: never; stored: never }) =>
        useWithStoredReferences({
          fields: FIELDS,
          documentKey: DOCUMENT,
          ...props,
          scope: "e",
        }),
      {
        initialProps: {
          populated: read(populatedV1),
          stored: read(storedV1),
        },
      }
    );
    expect(result.current.document).toBeDefined();

    const newer = { ...populatedV1, updatedAt: "v2" };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      rerender({ populated: read(newer), stored: read(storedV1) });
      rerender({
        populated: read(newer, { isFetching: true }),
        stored: read(storedV1, { isFetching: true }),
      });
    }
    rerender({ populated: read(newer), stored: read(storedV1) });
    expect(result.current.document).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toMatch(/kept changing/);
  });

  it("does not take one timestamp for one version when the links disagree", () => {
    // Two writes in one second share a timestamp kept to the second. A row the
    // stored read lacks shows the populated read is of the later one.
    const refetch = vi.fn();
    const { result } = renderHook(() =>
      useWithStoredReferences({
        fields: FIELDS,
        documentKey: DOCUMENT,
        populated: read(
          { ...populatedV1, pages: [pageA, { id: "new", title: "New" }] },
          { refetch }
        ),
        stored: read(storedV1, { refetch }),
        scope: "e",
      })
    );
    expect(result.current.document).toBeUndefined();
    expect(refetch).toHaveBeenCalled();
  });

  it("does not hand over a merge made for another language", () => {
    const { result, rerender } = renderHook(
      (props: { scope: string; populated: never; stored: never }) =>
        useWithStoredReferences({
          fields: FIELDS,
          documentKey: DOCUMENT,
          ...props,
        }),
      {
        initialProps: {
          scope: "e:en",
          populated: read(populatedV1),
          stored: read(storedV1),
        },
      }
    );
    expect(result.current.document).toBeDefined();

    rerender({
      scope: "e:es",
      populated: read(undefined, { isFetching: true }),
      stored: read(undefined, { isFetching: true }),
    });
    expect(result.current).toMatchObject({
      document: undefined,
      isLoading: true,
    });
  });
});

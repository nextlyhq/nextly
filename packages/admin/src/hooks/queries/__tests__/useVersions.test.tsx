/**
 * History paging is keyset, not page-numbered, and the response carries no
 * cursor — the client derives it from the page it just received. That derivation
 * is the part worth pinning: getting it wrong either stops paging early or
 * queries against a null anchor.
 */
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

const { listSpy, getSpy, diffSpy, baselineDiffSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
  getSpy: vi.fn(),
  diffSpy: vi.fn(),
  baselineDiffSpy: vi.fn(),
}));

// The API client is replaced so these tests drive query and mutation outcomes
// directly — including a failing restore — without a network round trip.
vi.mock("@admin/services/versionApi", () => ({
  versionApi: {
    list: listSpy,
    get: getSpy,
    diff: diffSpy,
    diffFromBaseline: baselineDiffSpy,
  },
}));

import {
  useBaselineDiff,
  useVersion,
  useVersionDiff,
  useVersions,
} from "../useVersions";

const scope = { kind: "collection" as const, slug: "posts", entryId: "e1" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function page(items: unknown[], hasNext: boolean) {
  return { items, meta: { hasNext } };
}

/**
 * Mirrors the app's QueryProvider, which turns focus refetch off for every
 * query. The shared wrapper leaves the library default (on) in place, so a
 * focus-refetch test against it would pass whether or not the hook opts back
 * in — the same trap the restore-retry test avoids.
 */
function providerFocusWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useVersions", () => {
  beforeEach(() => vi.clearAllMocks());
  // Focus state lives on a global singleton; reset it so a simulated focus in
  // one test does not carry into the next.
  afterEach(() => focusManager.setFocused(undefined));

  it("requests the first page without a cursor", async () => {
    listSpy.mockResolvedValue(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listSpy).toHaveBeenCalledWith(
      scope,
      expect.not.objectContaining({ cursor: expect.anything() })
    );
  });

  it("pages from the oldest version number on the page just received", async () => {
    listSpy.mockResolvedValueOnce(
      page([{ versionNo: 5 }, { versionNo: 4 }], true)
    );
    listSpy.mockResolvedValueOnce(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await result.current.fetchNextPage();

    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        scope,
        expect.objectContaining({ cursor: 4 })
      )
    );
  });

  it("stops paging when the server reports no further page", async () => {
    listSpy.mockResolvedValue(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.hasNextPage).toBe(false);
  });

  it("stops paging when the last row cannot anchor a cursor", async () => {
    // An autosave row carries a null versionNo. Paging from it would query
    // against a null anchor and match nothing.
    listSpy.mockResolvedValue(page([{ versionNo: null }], true));

    const { result } = renderHook(() => useVersions({ scope }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.hasNextPage).toBe(false);
  });

  it("stays idle for an entry that has no id yet", () => {
    // An empty entryId interpolates into a URL that addresses the collection
    // rather than an entry, so the request must not be made at all.
    renderHook(() => useVersions({ scope: { ...scope, entryId: "" } }), {
      wrapper,
    });

    expect(listSpy).not.toHaveBeenCalled();
  });

  it("stays idle for a Single whose live document is unknown", () => {
    renderHook(
      () =>
        useVersions({
          scope: { kind: "single", slug: "settings", documentId: "" },
        }),
      { wrapper }
    );

    expect(listSpy).not.toHaveBeenCalled();
  });

  it("keeps two documents' histories in separate cache entries", async () => {
    listSpy.mockResolvedValue(page([{ versionNo: 1 }], false));
    const other = { ...scope, entryId: "e2" };

    const a = renderHook(() => useVersions({ scope }), { wrapper });
    const b = renderHook(() => useVersions({ scope: other }), { wrapper });

    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));

    expect(listSpy).toHaveBeenCalledWith(scope, expect.anything());
    expect(listSpy).toHaveBeenCalledWith(other, expect.anything());
  });

  it("revalidates the history when the window regains focus", async () => {
    // A save in another tab adds a version, and "Compare with current" reads
    // the newest row from this list, so returning to the panel must revalidate
    // the head. The provider disables focus refetch app-wide, so the hook opts
    // back in; the mirrored wrapper proves it is the opt-in, not the default.
    listSpy.mockResolvedValue(page([{ versionNo: 3 }], false));

    const { result } = renderHook(() => useVersions({ scope }), {
      wrapper: providerFocusWrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listSpy).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });
});

describe("useVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the requested version", async () => {
    getSpy.mockResolvedValue({ versionNo: 2, snapshot: {} });

    const { result } = renderHook(() => useVersion({ scope, versionNo: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getSpy).toHaveBeenCalledWith(scope, 2);
  });

  it("does not fetch without a version number", () => {
    renderHook(() => useVersion({ scope, versionNo: null }), { wrapper });

    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe("useVersionDiff", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => focusManager.setFocused(undefined));

  it("revalidates the diff when the window regains focus", async () => {
    // The server classifies snapshots against the live schema, so a schema
    // edited in another tab must reclassify on return rather than keep showing
    // an obsolete diff. The provider disables focus refetch app-wide, so the
    // hook opts back in; the mirrored wrapper proves it is the opt-in at work.
    diffSpy.mockResolvedValue({
      from: 1,
      to: 2,
      locale: null,
      hasChanges: false,
      fields: [],
    });

    const { result } = renderHook(
      () => useVersionDiff({ scope, from: 1, to: 2 }),
      { wrapper: providerFocusWrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(diffSpy).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(diffSpy).toHaveBeenCalledTimes(2));
  });
});

describe("useBaselineDiff", () => {
  beforeEach(() => vi.clearAllMocks());
  // Focus and connection are global singletons; reset them so a simulated
  // return in one test does not carry into the next.
  afterEach(() => {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  it("resolves what is published again when the reader returns or the network does", async () => {
    // A publish in another tab changes what "published" names, so the
    // comparison and the restore it offers follow it. The mirrored wrapper
    // turns focus refetch off app-wide, so only the hook's own opt-in counts.
    baselineDiffSpy.mockResolvedValue({
      from: 3,
      to: 5,
      locale: null,
      hasChanges: true,
      fields: [],
      baseline: { name: "published", versionNo: 3 },
    });

    const { result } = renderHook(
      () => useBaselineDiff({ scope, baseline: "published", to: 5 }),
      { wrapper: providerFocusWrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(baselineDiffSpy).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(baselineDiffSpy).toHaveBeenCalledTimes(2));

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await waitFor(() => expect(baselineDiffSpy).toHaveBeenCalledTimes(3));
  });

  it("asks the server to compare a version with a baseline it resolves", async () => {
    baselineDiffSpy.mockResolvedValue({
      from: 3,
      to: 5,
      locale: null,
      hasChanges: true,
      fields: [],
      baseline: { name: "published", versionNo: 3 },
    });

    const { result } = renderHook(
      () => useBaselineDiff({ scope, baseline: "published", to: 5 }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(baselineDiffSpy).toHaveBeenCalledWith(scope, "published", {
      to: 5,
    });
    expect(result.current.data?.baseline).toEqual({
      name: "published",
      versionNo: 3,
    });
  });

  it("asks for nothing while no baseline is named", () => {
    renderHook(() => useBaselineDiff({ scope, baseline: null }), { wrapper });

    expect(baselineDiffSpy).not.toHaveBeenCalled();
  });

  it("keeps the comparison on screen while another baseline of the same document loads", async () => {
    // One client for every render, so the cache outlives the rerender.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const ownWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    baselineDiffSpy
      .mockResolvedValueOnce({
        from: 3,
        to: 5,
        locale: null,
        hasChanges: true,
        fields: [],
        baseline: { name: "published", versionNo: 3 },
      })
      .mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ baseline }: { baseline: string }) =>
        useBaselineDiff({ scope, baseline, to: 5 }),
      { wrapper: ownWrapper, initialProps: { baseline: "published" } }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ baseline: "draft" });
    await waitFor(() =>
      expect(baselineDiffSpy).toHaveBeenCalledWith(scope, "draft", { to: 5 })
    );

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.from).toBe(3);
  });

  it("keeps no other document's comparison while this document's loads", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const ownWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const other = { kind: "collection" as const, slug: "posts", entryId: "e2" };
    baselineDiffSpy
      .mockResolvedValueOnce({
        from: 3,
        to: 5,
        locale: null,
        hasChanges: true,
        fields: [],
        baseline: { name: "published", versionNo: 3 },
      })
      .mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ docScope }: { docScope: typeof scope | typeof other }) =>
        useBaselineDiff({ scope: docScope, baseline: "published", to: 5 }),
      { wrapper: ownWrapper, initialProps: { docScope: scope } }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ docScope: other });
    await waitFor(() =>
      expect(baselineDiffSpy).toHaveBeenCalledWith(other, "published", {
        to: 5,
      })
    );

    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  it("asks in the page's language when no version is named, and keeps each language's answer apart", async () => {
    // With no version named, the server picks the part to compare by the
    // language asked for; without it a French address compares the default
    // language's part instead.
    baselineDiffSpy.mockResolvedValue({
      from: 3,
      to: 5,
      locale: "fr",
      hasChanges: true,
      fields: [],
      baseline: { name: "published", versionNo: 3 },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ownWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const fr = renderHook(
      () => useBaselineDiff({ scope, baseline: "published", locale: "fr" }),
      { wrapper: ownWrapper }
    );
    await waitFor(() => expect(fr.result.current.isSuccess).toBe(true));
    expect(baselineDiffSpy).toHaveBeenCalledWith(scope, "published", {
      locale: "fr",
    });

    // Another language is another question, never the French answer reused.
    const de = renderHook(
      () => useBaselineDiff({ scope, baseline: "published", locale: "de" }),
      { wrapper: ownWrapper }
    );
    await waitFor(() => expect(de.result.current.isSuccess).toBe(true));
    expect(baselineDiffSpy).toHaveBeenCalledWith(scope, "published", {
      locale: "de",
    });
    expect(baselineDiffSpy).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("never answers a language named like the absent one with the absent one's answer", async () => {
    // A language code is whatever the app configures, so no word can stand
    // for "no language" in the key without some code meaning the same.
    baselineDiffSpy.mockResolvedValue({
      from: 3,
      to: 5,
      locale: null,
      hasChanges: true,
      fields: [],
      baseline: { name: "published", versionNo: 3 },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ownWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    // One mounted comparison moving between parts, as the page does when its
    // address changes: a key shared by two parts would ask nothing new.
    const { result, rerender } = renderHook(
      ({ locale }: { locale?: string }) =>
        useBaselineDiff({
          scope,
          baseline: "last-viewed",
          ...(locale !== undefined ? { locale } : {}),
        }),
      { wrapper: ownWrapper, initialProps: {} }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const code of ["any", "auto", "null"]) {
      rerender({ locale: code });
      await waitFor(() =>
        expect(baselineDiffSpy).toHaveBeenCalledWith(scope, "last-viewed", {
          locale: code,
        })
      );
    }
    expect(baselineDiffSpy).toHaveBeenCalledTimes(4);
    client.clear();
  });

  it("keeps the version last looked at for the visit, and resolves it again on the next", async () => {
    // The app's own cache time, so the first visit's answer is still held
    // when the reader comes back.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ownWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    baselineDiffSpy
      .mockResolvedValueOnce({
        from: 3,
        to: 5,
        locale: null,
        hasChanges: true,
        fields: [],
        baseline: { name: "last-viewed", versionNo: 3 },
      })
      .mockResolvedValueOnce({
        from: 5,
        to: 6,
        locale: null,
        hasChanges: true,
        fields: [],
        baseline: { name: "last-viewed", versionNo: 5 },
      });

    const first = renderHook(
      () => useBaselineDiff({ scope, baseline: "last-viewed" }),
      { wrapper: ownWrapper }
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    // Drawn again within the visit, it is the same answer, not a new question.
    first.rerender();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(baselineDiffSpy).toHaveBeenCalledTimes(1);
    first.unmount();

    // Version 5 was seen on that visit and version 6 saved since: the next
    // visit compares 5 with 6, not the pair the last one resolved.
    const second = renderHook(
      () => useBaselineDiff({ scope, baseline: "last-viewed" }),
      { wrapper: ownWrapper }
    );
    await waitFor(() => expect(second.result.current.data?.from).toBe(5));
    expect(baselineDiffSpy).toHaveBeenCalledTimes(2);
    client.clear();
  });
});

describe("a baseline comparison's fields", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  /** One client for both hooks, mirroring the app's focus default. */
  function sharedClient() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    const ownWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, ownWrapper };
  }

  const answer = (name: string) => ({
    from: 3,
    to: 5,
    locale: null,
    hasChanges: true,
    fields: [{ name: "title" }],
    baseline: { name, versionNo: 3 },
  });

  it("draws the pair from the baseline's own answer, without asking for it again", async () => {
    const { client, ownWrapper } = sharedClient();
    baselineDiffSpy.mockResolvedValue(answer("published"));

    const baseline = renderHook(
      () => useBaselineDiff({ scope, baseline: "published", to: 5 }),
      { wrapper: ownWrapper }
    );
    await waitFor(() => expect(baseline.result.current.isSuccess).toBe(true));

    // Mounted once the answer has named the pair, as the page mounts its view.
    const pair = renderHook(
      () => useVersionDiff({ scope, from: 3, to: 5, seededBy: "published" }),
      { wrapper: ownWrapper }
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(diffSpy).not.toHaveBeenCalled();
    expect(pair.result.current.data?.fields).toEqual([{ name: "title" }]);
    // The note about the baseline belongs to the page, not to the pair.
    expect(pair.result.current.data?.baseline).toBeUndefined();

    // On return the baseline is asked again, and its answer is the pair's:
    // the pair is not asked a second time beside it.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(baselineDiffSpy).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(diffSpy).not.toHaveBeenCalled();
    client.clear();
  });

  it("still revalidates a frozen baseline's pair on return, against the live schema", async () => {
    const { client, ownWrapper } = sharedClient();
    baselineDiffSpy.mockResolvedValue(answer("last-viewed"));
    diffSpy.mockResolvedValue({
      ...answer("last-viewed"),
      baseline: undefined,
    });

    const baseline = renderHook(
      () => useBaselineDiff({ scope, baseline: "last-viewed", to: 5 }),
      { wrapper: ownWrapper }
    );
    await waitFor(() => expect(baseline.result.current.isSuccess).toBe(true));
    renderHook(
      () => useVersionDiff({ scope, from: 3, to: 5, seededBy: "last-viewed" }),
      { wrapper: ownWrapper }
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(diffSpy).not.toHaveBeenCalled();

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(diffSpy).toHaveBeenCalledTimes(1));
    expect(baselineDiffSpy).toHaveBeenCalledTimes(1);
    client.clear();
  });
});

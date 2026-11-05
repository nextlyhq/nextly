/**
 * A collection read that answers 404 is read again as a Single only when the
 * admin knows the slug is a Single.
 *
 * The server answers 404 for an entry that is missing and, the same way, for
 * one the caller may not read. Reading `/singles/<slug>` after every such 404
 * costs a request and can only stand in for the server's own answer, so the
 * second read is kept for a slug the capabilities answer calls a Single.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("@admin/lib/api/fetcher", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/lib/api/fetcher")>();
  return { ...actual, fetcher: fetcherSpy };
});

import { currentUserCapabilitiesKey } from "@admin/hooks/current-user-access";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type { CapabilitiesResponse } from "@admin/types/permissions";

import { useEntries } from "../useEntries";
import { useEntry } from "../useEntry";

const NOT_FOUND = "Not found.";

function notFound() {
  return parseApiError(
    { error: { code: "NOT_FOUND", message: NOT_FOUND, requestId: "req-1" } },
    404
  );
}

/** The capabilities answer, naming `posts` a collection and `site-settings` a Single. */
const ANSWER: CapabilitiesResponse = {
  isSuperAdmin: false,
  validUntil: null,
  entities: {
    posts: {
      kind: "collection",
      read: true,
      update: true,
      publish: true,
      unpublish: true,
    },
    "site-settings": {
      kind: "single",
      read: true,
      update: true,
      publish: true,
      unpublish: true,
    },
  },
};

function makeClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserCapabilitiesKey(undefined), ANSWER);
  return client;
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** The paths the reads asked for, without their query strings. */
function pathsAsked(): string[] {
  return fetcherSpy.mock.calls.map(call => String(call[0]).split("?")[0]);
}

beforeEach(() => vi.clearAllMocks());

describe("one entry", () => {
  it("answers a collection's 404 with the server's message, and reads nothing else", async () => {
    fetcherSpy.mockRejectedValue(notFound());

    const { result } = renderHook(
      () => useEntry({ collectionSlug: "posts", entryId: "e1" }),
      { wrapper: makeWrapper(makeClient()) }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(NOT_FOUND);
    expect(pathsAsked()).toEqual(["/collections/posts/entries/e1"]);
  });

  it("reads a known Single's document after the collection read's 404", async () => {
    // The control: without it, a read that never fell back would pass the
    // case above.
    fetcherSpy
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ id: "s1", siteName: "Nextly" });

    const { result } = renderHook(
      () => useEntry({ collectionSlug: "site-settings", entryId: "s1" }),
      { wrapper: makeWrapper(makeClient()) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "s1", siteName: "Nextly" });
    expect(pathsAsked()).toEqual([
      "/collections/site-settings/entries/s1",
      "/singles/site-settings",
    ]);
  });
});

describe("a list", () => {
  it("answers a collection's 404 with the server's message, and reads nothing else", async () => {
    fetcherSpy.mockRejectedValue(notFound());

    const { result } = renderHook(
      () => useEntries({ collectionSlug: "posts" }),
      { wrapper: makeWrapper(makeClient()) }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(NOT_FOUND);
    expect(pathsAsked()).toEqual(["/collections/posts/entries"]);
  });

  it("lists a known Single's document after the collection read's 404", async () => {
    fetcherSpy
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ id: "s1", siteName: "Nextly" });

    const { result } = renderHook(
      () => useEntries({ collectionSlug: "site-settings" }),
      { wrapper: makeWrapper(makeClient()) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([
      { id: "s1", siteName: "Nextly" },
    ]);
    expect(pathsAsked()).toEqual([
      "/collections/site-settings/entries",
      "/singles/site-settings",
    ]);
  });

  it("does not read a slug as a Single before the capabilities answer names it", async () => {
    // Unknown is not a Single: with no answer cached, nothing says the slug
    // is one, so the collection's own 404 stands.
    fetcherSpy.mockRejectedValue(notFound());
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(
      () => useEntries({ collectionSlug: "site-settings" }),
      { wrapper: makeWrapper(client) }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(NOT_FOUND);
    expect(pathsAsked()).toEqual(["/collections/site-settings/entries"]);
  });
});

describe("a capabilities answer that arrives after the read", () => {
  // A cold load can ask for the entry before the capabilities answer is in.
  // The collection read's 404 then stands, and once the answer arrives and
  // names the slug a Single, the read is asked again and falls back.
  function emptyClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }

  it("reads a Single's document once the answer names it, for one entry", async () => {
    fetcherSpy
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ id: "s1", siteName: "Nextly" });
    const client = emptyClient();

    const { result } = renderHook(
      () => useEntry({ collectionSlug: "site-settings", entryId: "s1" }),
      { wrapper: makeWrapper(client) }
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    client.setQueryData(currentUserCapabilitiesKey(undefined), ANSWER);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "s1", siteName: "Nextly" });
    expect(pathsAsked()).toEqual([
      "/collections/site-settings/entries/s1",
      "/collections/site-settings/entries/s1",
      "/singles/site-settings",
    ]);
  });

  it("lists a Single's document once the answer names it", async () => {
    fetcherSpy
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ id: "s1", siteName: "Nextly" });
    const client = emptyClient();

    const { result } = renderHook(
      () => useEntries({ collectionSlug: "site-settings" }),
      { wrapper: makeWrapper(client) }
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    client.setQueryData(currentUserCapabilitiesKey(undefined), ANSWER);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([
      { id: "s1", siteName: "Nextly" },
    ]);
    expect(pathsAsked()).toEqual([
      "/collections/site-settings/entries",
      "/collections/site-settings/entries",
      "/singles/site-settings",
    ]);
  });
});

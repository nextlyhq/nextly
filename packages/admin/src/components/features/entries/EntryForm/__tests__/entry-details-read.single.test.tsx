/**
 * A Single's details, read the way an entry's are: the Single's own read with
 * `?details=1`, kept under the Single's document key so a save of it, which
 * refreshes that key, refreshes who changed it too.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";
import { singleDocumentKeys } from "@admin/hooks/queries/useSingles";
import { protectedApi } from "@admin/lib/api/protectedApi";

import { useEntryDetails } from "../entry-details-read";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn() },
}));

const get = vi.mocked(protectedApi.get);
const ANSWER = {
  createdBy: null,
  updatedBy: { kind: "person", name: "Ana Lopez" },
  updatedAt: "2026-11-16T10:00:00.000Z",
  address: null,
};

function wrapperFor(client: ReturnType<typeof createTestQueryClient>) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ id: "s1", _details: ANSWER });
});

describe("useEntryDetails for a Single", () => {
  it("reads the Single's own address with ?details=1", async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(
      () =>
        useEntryDetails({
          scope: "single",
          collectionSlug: "contact-details",
          entryId: "s1",
          locale: "fr",
        }),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(result.current).toEqual(ANSWER));
    const [url] = get.mock.calls[0]!;
    const [path, search] = String(url).split("?");
    expect(path).toBe("/singles/contact-details");
    const query = new URLSearchParams(search);
    expect(query.get("details")).toBe("1");
    expect(query.get("status")).toBe("all");
    expect(query.get("locale")).toBe("fr");
  });

  it("reads again when the Single's document key is refreshed, as a save does", async () => {
    const client = createTestQueryClient();
    renderHook(
      () =>
        useEntryDetails({
          scope: "single",
          collectionSlug: "contact-details",
          entryId: "s1",
          locale: undefined,
        }),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await client.invalidateQueries({
      queryKey: singleDocumentKeys.detail("contact-details"),
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("asks nothing before the Single exists", () => {
    const client = createTestQueryClient();
    renderHook(
      () =>
        useEntryDetails({
          scope: "single",
          collectionSlug: "contact-details",
          entryId: undefined,
          locale: undefined,
        }),
      { wrapper: wrapperFor(client) }
    );
    expect(get).not.toHaveBeenCalled();
  });
});

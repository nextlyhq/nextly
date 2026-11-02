/**
 * The "seen" mark on a version, for a document whose collection or Single was
 * removed from code.
 *
 * The mark is a write, and the server refuses every write to such a document.
 * Where the editor already knows that, no mark is sent. Where it does not (a
 * screen opened before the removal), the refusal is not swallowed: it reads
 * the entity's schema again, as every other write's refusal does, so the
 * screen turns read-only.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { markSeen } = vi.hoisted(() => ({ markSeen: vi.fn() }));

vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return { ...actual, versionApi: { ...actual.versionApi, markSeen } };
});

import { collectionKeys } from "@admin/hooks/queries/useCollections";
import { singleKeys } from "@admin/hooks/queries/useSingles";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type { VersionScope } from "@admin/services/versionApi";

import { useMarkVersionSeen } from "../useMarkVersionSeen";

const ENTRY: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};
const SINGLE: VersionScope = { kind: "single", slug: "home", documentId: "d1" };

function refusal(kind: "collection" | "single", slug: string) {
  return parseApiError(
    {
      error: {
        code: "ENTITY_REMOVED_FROM_CODE",
        message: `The ${kind} "${slug}" was removed from code.`,
        data: { kind, slug },
        requestId: "r1",
      },
    },
    409
  );
}

function setup() {
  const client = new QueryClient();
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
}

beforeEach(() => {
  markSeen.mockReset();
  markSeen.mockResolvedValue(undefined);
});

describe("useMarkVersionSeen", () => {
  it("marks a shown version seen", async () => {
    // The control: an ordinary document's version is marked once shown.
    const { wrapper } = setup();
    renderHook(() => useMarkVersionSeen(ENTRY, "posts/e1", 3), { wrapper });

    await waitFor(() => expect(markSeen).toHaveBeenCalledWith(ENTRY, 3));
  });

  it("sends no mark where writes to the document are refused", async () => {
    const { wrapper } = setup();
    renderHook(
      () => useMarkVersionSeen(ENTRY, "posts/e1", 3, { writesRefused: true }),
      { wrapper }
    );

    // Given the effect a chance to run before asking what it sent.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("reads the collection's schema again when the mark is refused", async () => {
    markSeen.mockRejectedValue(refusal("collection", "posts"));
    const { invalidate, wrapper } = setup();
    renderHook(() => useMarkVersionSeen(ENTRY, "posts/e1", 3), { wrapper });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: collectionKeys.all(),
      })
    );
  });

  it("reads the Single's schema again when the mark is refused", async () => {
    markSeen.mockRejectedValue(refusal("single", "home"));
    const { invalidate, wrapper } = setup();
    renderHook(() => useMarkVersionSeen(SINGLE, "home", 2), { wrapper });

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: singleKeys.all() })
    );
  });

  it("still swallows any other failure, which changes nothing on screen", async () => {
    markSeen.mockRejectedValue(new TypeError("Failed to fetch"));
    const { invalidate, wrapper } = setup();
    renderHook(() => useMarkVersionSeen(ENTRY, "posts/e1", 3), { wrapper });

    await waitFor(() => expect(markSeen).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

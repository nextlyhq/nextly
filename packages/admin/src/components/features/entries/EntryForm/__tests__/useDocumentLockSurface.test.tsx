import type { DocumentLockHolder } from "nextly/document-lock";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { renderHook } from "@admin/__tests__/utils";

const { useDocumentLock } = vi.hoisted(() => ({ useDocumentLock: vi.fn() }));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));

import { useDocumentLockSurface } from "../useDocumentLockSurface";

const bob: DocumentLockHolder = {
  ownerId: "u2",
  ownerLabel: "Bob",
  expiresInSeconds: 90,
};
const takeOver = vi.fn();
const options = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("remembering who held the document", () => {
  it("keeps a colleague through a failed refresh", () => {
    // 🔴 Every beat re-asks, so a transient rejection arrives long after a holder
    // was reported. Forgetting them hands the document to a second editor while
    // the last confirmed fact is that somebody holds an unexpired lease.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );
    expect(result.current.readOnly).toBe(true);

    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
    });
    rerender();

    expect(result.current.readOnly).toBe(true);
    expect(result.current.notice?.message).toContain("Bob");
  });

  it("forgets them when a new document is being claimed", () => {
    // 🔴 Both editors reuse the mounted hook when the id changes, and a new
    // document announces itself as `acquiring`. Carrying the last one's holder
    // into it renders a document read-only over a colleague who was never in it.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );
    expect(result.current.readOnly).toBe(true);

    useDocumentLock.mockReturnValue({
      state: { status: "acquiring" },
      takeOver,
    });
    rerender();
    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
    });
    rerender();

    expect(result.current.readOnly).toBe(false);
    expect(result.current.notice?.takeOverLabel).toBeNull();
  });

  it("forgets them once this editor holds it", () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });
    const { result, rerender } = renderHook(() =>
      useDocumentLockSurface(options)
    );

    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });
    rerender();
    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
    });
    rerender();

    expect(result.current.readOnly).toBe(false);
  });
});

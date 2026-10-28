/**
 * The lock surface of a user who may read a document and not change it.
 *
 * They make no claim, since the server refuses one without update. A reader
 * who may publish still writes the document's status, so a colleague's claim
 * holds those writes back until it is let go: a publish while the colleague
 * is mid-edit would put their unfinished change live.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get, post, patch, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get, post, patch, delete: del },
}));

import { DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS } from "nextly/document-lock";

import { useDocumentLockSurface } from "../useDocumentLockSurface";

const ref = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "42",
};
const other = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  get.mockResolvedValue({ holder: other });
  post.mockResolvedValue({
    message: "",
    item: { status: "acquired", claimToken: "t1" },
  });
  // An editor's claim is released when the surface unmounts.
  del.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

const asReader = () =>
  renderHook(() => useDocumentLockSurface({ ...ref, readOnlyForReader: true }));

describe("the lock surface of a reader", () => {
  it("holds their writes while a colleague holds the document, and claims nothing", async () => {
    const { result } = asReader();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(result.current.actionsDisabled).toBe(true);
    expect(result.current.readOnly).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("holds their writes until the lock has been read", () => {
    get.mockReturnValue(new Promise(() => {}));
    const { result } = asReader();

    expect(result.current.actionsDisabled).toBe(true);
  });

  it("lets their writes through once nobody holds the document", async () => {
    get.mockResolvedValue({ holder: null });
    const { result } = asReader();

    await waitFor(() => expect(result.current.actionsDisabled).toBe(false));
    expect(result.current.readOnly).toBe(true);
  });

  it("holds them again when a colleague claims it later", async () => {
    get.mockResolvedValueOnce({ holder: null });
    const { result } = asReader();
    await waitFor(() => expect(result.current.actionsDisabled).toBe(false));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);
    });

    await waitFor(() => expect(result.current.actionsDisabled).toBe(true));
  });

  it("leaves an editor claiming the document as before", async () => {
    // POPULATION CONTROL: only the reader observes instead of claiming.
    const { result } = renderHook(() => useDocumentLockSurface(ref));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(get).not.toHaveBeenCalled();
    expect(result.current.actionsDisabled).toBe(false);
  });
});

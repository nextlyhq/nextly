/**
 * A session on a second document: read, lock, save as draft, publish, record
 * a recovery point and let go, each through the admin's own pieces.
 *
 * Driven through the real lock, read, update and recording hooks, with only
 * the network stood in for: the point of the session is that it adds no rule
 * of its own, so a stubbed lock or update would be testing a copy.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  findByID: vi.fn(),
  update: vi.fn(),
  getSchema: vi.fn(),
  saveAutosave: vi.fn(),
  can: vi.fn(),
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { post: api.post, patch: api.patch, delete: api.del },
}));
vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      findByID: api.findByID,
      update: api.update,
    },
  };
});
vi.mock("@admin/services/collectionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/collectionApi")>();
  return {
    ...actual,
    collectionApi: { ...actual.collectionApi, getSchema: api.getSchema },
  };
});
vi.mock("@admin/services/versionApi", () => ({
  versionApi: { saveAutosave: api.saveAutosave },
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: api.can }));

import { parseApiError } from "@admin/lib/api/parseApiError";

import {
  useDocumentSession,
  type DocumentSessionTarget,
} from "../useDocumentSession";

const HEADER: DocumentSessionTarget = { collection: "components", id: "h1" };
const LOCK = { scopeKind: "collection", slug: "components", entryId: "h1" };
const DEBOUNCE_WAIT = 5_000;

/** The header as stored: live, with a working draft held over it. */
const STORED = {
  id: "h1",
  title: "Main header",
  area: "header",
  definition: { kind: "component", nodes: [] },
  status: "published",
  _isWorkingDraft: true,
  updatedAt: "2026-11-17T09:30:00.000Z",
  _rev: "v1",
};

const acquired = {
  message: "",
  item: { status: "acquired", claimToken: "t1" },
};
const heldByBob = {
  message: "",
  item: {
    status: "held",
    holder: { ownerId: "u2", ownerLabel: "Bob Lee", expiresInSeconds: 90 },
    waiting: false,
  },
};

function wrapper(): (props: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

/** A session on the header, rendered, once it holds the lock and read it. */
async function openSession(target: DocumentSessionTarget | null = HEADER) {
  const view = renderHook(
    ({ named }: { named: DocumentSessionTarget | null }) =>
      useDocumentSession(named),
    { wrapper: wrapper(), initialProps: { named: target } }
  );
  if (target !== null) {
    await waitFor(() => expect(view.result.current.open.status).toBe("ready"));
  }
  return view;
}

async function heldSession() {
  const view = await openSession();
  await waitFor(() => expect(view.result.current.lock.status).toBe("held"));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.post.mockResolvedValue(acquired);
  api.patch.mockResolvedValue({
    message: "",
    item: { status: "renewed", waiting: false },
  });
  api.del.mockResolvedValue(undefined);
  api.getSchema.mockResolvedValue({
    name: "components",
    status: true,
    draftsEnabled: true,
  });
  api.findByID.mockResolvedValue(STORED);
  api.update.mockImplementation(
    async (_slug: string, _id: string, data: Record<string, unknown>) => ({
      item: { ...STORED, ...data, _rev: "v2" },
      warnings: [],
    })
  );
  api.saveAutosave.mockResolvedValue({
    updatedAt: "2026-11-18T09:00:00.000Z",
    locale: null,
  });
  api.can.mockImplementation(
    (permission: string) => permission === "publish-components"
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentSession: open", () => {
  it("reads the latest version, the working draft in place of the live row", async () => {
    const { result } = await openSession();

    expect(api.findByID).toHaveBeenCalledWith(
      "components",
      "h1",
      expect.objectContaining({ draft: true }),
      expect.anything()
    );
    expect(result.current.open).toEqual({
      status: "ready",
      values: STORED,
      published: true,
      unpublishedChanges: true,
      changedAt: "2026-11-17T09:30:00.000Z",
      draftable: true,
    });
  });

  it("says a live document with no working draft has nothing unpublished", async () => {
    api.findByID.mockResolvedValue({ ...STORED, _isWorkingDraft: false });
    const { result } = await openSession();

    expect(result.current.open).toMatchObject({
      status: "ready",
      unpublishedChanges: false,
    });
  });

  it("reads nothing and claims nothing while no document is named", async () => {
    const { result } = await openSession(null);
    await act(async () => void vi.advanceTimersByTime(DEBOUNCE_WAIT));

    expect(result.current.open.status).toBe("loading");
    expect(result.current.lock.status).toBe("claiming");
    expect(api.findByID).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("useDocumentSession: lock", () => {
  it("claims the named document through the admin's lock", async () => {
    await heldSession();

    expect(api.post).toHaveBeenCalledWith(
      "/document-lock",
      expect.objectContaining({ ...LOCK, takeover: false })
    );
  });

  it("names whoever else holds it", async () => {
    api.post.mockResolvedValue(heldByBob);
    const { result } = await openSession();

    await waitFor(() =>
      expect(result.current.lock).toEqual({
        status: "held-by-other",
        holder: "Bob Lee",
      })
    );
  });

  it("lets go when the caller names no document any more", async () => {
    const view = await heldSession();

    view.rerender({ named: null });

    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith("/document-lock", {
        ...LOCK,
        claimToken: "t1",
      })
    );
    expect(view.result.current.lock.status).toBe("claiming");
  });

  it("lets go on unmount", async () => {
    const view = await heldSession();

    view.unmount();

    expect(api.del).toHaveBeenCalledWith("/document-lock", {
      ...LOCK,
      claimToken: "t1",
    });
  });
});

describe("useDocumentSession: save as draft and publish", () => {
  it("saves a draft of a live document as its working draft, from the version read", async () => {
    const { result } = await heldSession();
    const nodes = { kind: "component", nodes: [{ id: "n" }] };

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.saveDraft({ definition: nodes });
    });

    // No status: a status-less save of a live document stores the working
    // draft and leaves what visitors see.
    expect(api.update).toHaveBeenCalledWith(
      "components",
      "h1",
      { definition: nodes, _rev: "v1" },
      undefined
    );
    expect(outcome).toMatchObject({ ok: true });
  });

  it("stores a document never published as a draft", async () => {
    api.findByID.mockResolvedValue({ ...STORED, status: "draft" });
    const { result } = await heldSession();

    await act(async () => {
      await result.current.saveDraft({ title: "New" });
    });

    expect(api.update.mock.calls[0]?.[2]).toEqual({
      title: "New",
      status: "draft",
      _rev: "v1",
    });
  });

  it("publishes with the version read, and the next write sends the version it stored", async () => {
    const { result } = await heldSession();

    await act(async () => {
      await result.current.publish({ title: "One" });
    });
    await act(async () => {
      await result.current.saveDraft({ title: "Two" });
    });

    expect(api.update.mock.calls[0]?.[2]).toEqual({
      title: "One",
      status: "published",
      _rev: "v1",
    });
    expect(api.update.mock.calls[1]?.[2]).toMatchObject({
      title: "Two",
      _rev: "v2",
    });
  });

  it("refuses to write while someone else holds the lock", async () => {
    api.post.mockResolvedValue(heldByBob);
    const { result } = await openSession();
    await waitFor(() =>
      expect(result.current.lock.status).toBe("held-by-other")
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.publish({ title: "x" });
    });

    expect(outcome).toEqual({ ok: false, reason: "locked", message: null });
    expect(api.update).not.toHaveBeenCalled();
  });

  it("never writes the live row as a draft where the collection keeps no drafts", async () => {
    api.getSchema.mockResolvedValue({
      name: "components",
      status: true,
      draftsEnabled: false,
    });
    const { result } = await heldSession();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.saveDraft({ title: "x" });
    });

    expect(result.current.open).toMatchObject({ draftable: false });
    expect(outcome).toEqual({ ok: false, reason: "no-drafts", message: null });
    expect(api.update).not.toHaveBeenCalled();
  });

  it("says who saved a newer version when the write is refused as stale", async () => {
    api.update.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "STALE_VERSION",
            message: "Someone saved this since you opened it.",
            requestId: "r",
            data: {
              currentVersion: "v9",
              changedBy: { kind: "user", name: "Ana Diaz" },
            },
          },
        },
        409
      )
    );
    const { result } = await heldSession();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.publish({ title: "x" });
    });

    expect(outcome).toMatchObject({
      ok: false,
      reason: "stale",
      changedBy: "Ana Diaz",
    });
  });

  it("hands back the server's words for any other refusal", async () => {
    api.update.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "FORBIDDEN",
            message: "You can't publish components.",
            requestId: "r",
          },
        },
        403
      )
    );
    const { result } = await heldSession();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.publish({ title: "x" });
    });

    expect(outcome).toEqual({
      ok: false,
      reason: "refused",
      message: "You can't publish components.",
    });
  });

  it("answers whether the person may publish from the collection's publish grant", async () => {
    const { result } = await openSession();
    expect(result.current.mayPublish).toBe(true);
    expect(api.can).toHaveBeenCalledWith("publish-components");
  });
});

describe("useDocumentSession: recovery point", () => {
  it("records the whole document with the changes over it, keyed by that document", async () => {
    const { result } = await heldSession();

    act(() => result.current.record({ title: "Changed" }));
    await act(async () => void vi.advanceTimersByTime(DEBOUNCE_WAIT));

    await waitFor(() => expect(api.saveAutosave).toHaveBeenCalledTimes(1));
    const values: Record<string, unknown> = { ...STORED, title: "Changed" };
    delete values.id;
    expect(api.saveAutosave).toHaveBeenCalledWith(
      { kind: "collection", slug: "components", entryId: "h1" },
      values,
      null
    );
  });

  it("records nothing while someone else holds the document", async () => {
    api.post.mockResolvedValue(heldByBob);
    const { result } = await openSession();
    await waitFor(() =>
      expect(result.current.lock.status).toBe("held-by-other")
    );

    act(() => result.current.record({ title: "Changed" }));
    await act(async () => void vi.advanceTimersByTime(DEBOUNCE_WAIT));

    expect(api.saveAutosave).not.toHaveBeenCalled();
  });

  it("leaves a recovery point and no held lock when the page goes away mid-edit", async () => {
    // A crash or a closed tab runs no cleanup: the recording already made is
    // what the next opening offers, and `pagehide` hands the claim back so
    // nobody waits out a lease for an editor that is gone.
    const view = await heldSession();
    act(() => view.result.current.record({ title: "Unsaved" }));
    await act(async () => void vi.advanceTimersByTime(DEBOUNCE_WAIT));
    await waitFor(() => expect(api.saveAutosave).toHaveBeenCalledTimes(1));

    act(() => void window.dispatchEvent(new Event("pagehide")));

    expect(api.del).toHaveBeenCalledWith(
      "/document-lock",
      { ...LOCK, claimToken: "t1" },
      { keepalive: true }
    );
    // The point is kept: nothing emptied it.
    expect(api.saveAutosave).toHaveBeenCalledTimes(1);
    expect(api.saveAutosave.mock.calls[0]?.[1]).toMatchObject({
      title: "Unsaved",
    });
  });

  it("drops a recording not yet made when the work is saved", async () => {
    const { result } = await heldSession();

    act(() => result.current.record({ title: "Saved" }));
    await act(async () => {
      await result.current.saveDraft({ title: "Saved" });
    });
    await act(async () => void vi.advanceTimersByTime(DEBOUNCE_WAIT));

    expect(api.saveAutosave).not.toHaveBeenCalled();
  });

  it("empties the point it recorded when the changes are discarded", async () => {
    const { result } = await heldSession();
    act(() => result.current.record({ title: "Thrown away" }));
    await act(async () => void vi.advanceTimersByTime(DEBOUNCE_WAIT));
    await waitFor(() => expect(api.saveAutosave).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.discard();
    });

    expect(api.saveAutosave).toHaveBeenCalledTimes(2);
    expect(api.saveAutosave.mock.calls[1]?.[1]).toEqual({});
  });
});

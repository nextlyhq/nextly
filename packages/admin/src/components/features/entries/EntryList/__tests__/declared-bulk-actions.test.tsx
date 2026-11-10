/**
 * Plugins' declared bulk actions on the entry list: offered on a selection
 * only where their rule holds for every selected row as listed, and only on
 * the collections they are named for; one that runs a route calls the
 * plugin's own route with the action and every selected row; one that opens
 * a component answers it with the rows.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MAX_ACTION_ROWS } from "nextly/config";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { postSpy, toastSpy, branding } = vi.hoisted(() => ({
  postSpy: vi.fn(),
  toastSpy: { success: vi.fn(), error: vi.fn() },
  branding: { contributions: undefined as unknown },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    post: postSpy,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  },
}));
// A token in hand, as the write tests have it: what matters here is that the
// action's request carries it.
vi.mock("@admin/lib/api/csrf", () => ({
  csrfTokenForWrite: () => Promise.resolve("token"),
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: toastSpy,
}));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: branding.contributions }),
}));

import {
  declaredBulkActionsFor,
  type DeclaredAction,
} from "../declared-actions";
import { useDeclaredBulkActions } from "../useDeclaredBulkActions";

const CLOSE: DeclaredAction = {
  plugin: "@acme/support",
  id: "acme-support.close",
  kind: "bulkAction",
  label: "Close",
  collections: ["tickets"],
  action: { run: { method: "POST", path: "/close" } },
  visibleWhen: { field: "status", notEquals: "closed" },
};
const INSPECT: DeclaredAction = {
  plugin: "@acme/support",
  id: "acme-support.inspect",
  kind: "bulkAction",
  label: "Inspect",
  action: { open: "@acme/support/admin#Inspect" },
};

const CONTRIBUTIONS = {
  "collection.list": {
    bulkAction: [
      CLOSE,
      INSPECT,
      { ...CLOSE, id: "acme-support.orders-only", collections: ["orders"] },
    ],
    // A row action is not a bulk action, wherever it is listed.
    rowAction: [{ ...INSPECT, id: "acme-support.row", kind: "rowAction" }],
  },
};

const ROWS = [
  { id: "1", status: "open" },
  { id: "2", status: "open" },
  { id: "3", status: "closed" },
];

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  postSpy.mockReset();
  toastSpy.success.mockReset();
  toastSpy.error.mockReset();
  branding.contributions = CONTRIBUTIONS;
});

describe("the declared bulk actions a list offers", () => {
  it("offers a collection's bulk actions, in order, and none named for another", () => {
    expect(
      declaredBulkActionsFor(CONTRIBUTIONS as never, "tickets").map(a => a.id)
    ).toEqual(["acme-support.close", "acme-support.inspect"]);
  });

  it("offers an action on a selection only where its rule holds for every row", () => {
    const { result } = renderHook(
      () => useDeclaredBulkActions("tickets", ROWS),
      { wrapper }
    );
    const [close, inspect] = result.current.bulkActions;
    expect(close?.isDisabled(["1", "2"])).toBe(false);
    // One closed row in the selection, and the server would refuse it whole.
    expect(close?.isDisabled(["1", "3"])).toBe(true);
    // A selected row not on this page cannot be judged here.
    expect(close?.isDisabled(["1", "9"])).toBe(true);
    // An action without a rule is offered on any selection, that one too.
    expect(inspect?.isDisabled(["1", "9"])).toBe(false);
    // And on none, nothing.
    expect(inspect?.isDisabled([])).toBe(true);
  });
});

describe("the most rows a declared bulk action runs on", () => {
  // A route action without a rule, so only the count decides.
  const ARCHIVE: DeclaredAction = {
    ...CLOSE,
    id: "acme-support.archive",
    label: "Archive",
    visibleWhen: undefined,
  };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it("holds an action that calls its route back on more rows than the route takes, and says why", () => {
    branding.contributions = {
      "collection.list": { bulkAction: [ARCHIVE, INSPECT] },
    };
    const { result } = renderHook(
      () => useDeclaredBulkActions("tickets", ROWS),
      { wrapper }
    );
    const archive = result.current.bulkActions[0]!;

    expect(archive.isDisabled(ids(MAX_ACTION_ROWS))).toBe(false);
    expect(archive.heldBackNote(ids(MAX_ACTION_ROWS))).toBeUndefined();
    expect(archive.isDisabled(ids(MAX_ACTION_ROWS + 1))).toBe(true);
    expect(archive.heldBackNote(ids(MAX_ACTION_ROWS + 1))).toBe(
      `Archive runs on at most ${MAX_ACTION_ROWS} entries at a time.`
    );
  });

  it("offers one that opens a component on any number, as it sends nothing", () => {
    branding.contributions = {
      "collection.list": { bulkAction: [ARCHIVE, INSPECT] },
    };
    const { result } = renderHook(
      () => useDeclaredBulkActions("tickets", ROWS),
      { wrapper }
    );
    const inspect = result.current.bulkActions[1]!;

    expect(inspect.isDisabled(ids(MAX_ACTION_ROWS + 1))).toBe(false);
    expect(inspect.heldBackNote(ids(MAX_ACTION_ROWS + 1))).toBeUndefined();
  });
});

describe("what a declared bulk action opened", () => {
  it("closes when the list moves to another collection", async () => {
    branding.contributions = {
      "collection.list": {
        bulkAction: [{ ...INSPECT, collections: undefined }],
      },
    };
    const { result, rerender } = renderHook(
      ({ collection }: { collection: string }) =>
        useDeclaredBulkActions(collection, ROWS),
      { wrapper, initialProps: { collection: "tickets" } }
    );

    act(() => {
      result.current.bulkActions[0]?.onSelect(["1"]);
    });
    await waitFor(() => expect(result.current.opened).not.toBeNull());

    // The same page, another collection: its rows are not this one's.
    rerender({ collection: "orders" });
    expect(result.current.opened).toBeNull();
  });
});

describe("running a declared bulk action", () => {
  it("calls the plugin's own route once, with the action and every selected row", async () => {
    postSpy.mockResolvedValue({ message: "Closed." });
    const { result } = renderHook(
      () => useDeclaredBulkActions("tickets", ROWS),
      { wrapper }
    );

    await act(async () => {
      result.current.bulkActions[0]?.onSelect(["1", "2"]);
      await vi.waitFor(() => expect(toastSpy.success).toHaveBeenCalled());
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      "/plugins/@acme/support/close",
      {
        action: "acme-support.close",
        rows: [
          { collection: "tickets", id: "1" },
          { collection: "tickets", id: "2" },
        ],
      },
      { headers: { "x-csrf-token": "token" } }
    );
  });

  it("answers the component of one that opens, with the rows, and writes nothing", async () => {
    const { result } = renderHook(
      () => useDeclaredBulkActions("tickets", ROWS),
      { wrapper }
    );

    act(() => {
      result.current.bulkActions[1]?.onSelect(["1", "3"]);
    });
    await waitFor(() => expect(result.current.opened).not.toBeNull());

    expect(result.current.opened).toEqual({
      label: "Inspect",
      component: "@acme/support/admin#Inspect",
      rows: [
        { collection: "tickets", id: "1" },
        { collection: "tickets", id: "3" },
      ],
    });
    expect(postSpy).not.toHaveBeenCalled();
  });
});

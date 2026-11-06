/**
 * Plugins' declared row actions on the entry list: offered on a row only
 * where their rule holds for it as listed; one that runs a route calls the
 * plugin's own route with the action and the row, and the write's CSRF token;
 * one that opens a component draws it with the row. A refusal from the route
 * is said in its own words.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
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
  actionOfferedOn,
  declaredRowActionsFor,
  runDeclaredAction,
  type DeclaredAction,
} from "../declared-actions";
import { useDeclaredRowActions } from "../useDeclaredRowActions";

const ESCALATE: DeclaredAction = {
  plugin: "@acme/support",
  id: "acme-support.escalate",
  kind: "rowAction",
  label: "Escalate",
  collections: ["tickets"],
  action: { run: { method: "POST", path: "/escalate" } },
  visibleWhen: { field: "status", notEquals: "closed" },
};
const PREVIEW: DeclaredAction = {
  plugin: "@acme/support",
  id: "acme-support.preview",
  kind: "rowAction",
  label: "Preview",
  action: { open: "@acme/support/admin#Preview" },
};

const CONTRIBUTIONS = {
  "collection.list": {
    rowAction: [
      ESCALATE,
      PREVIEW,
      { ...ESCALATE, id: "acme-support.orders-only", collections: ["orders"] },
    ],
  },
};

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

describe("the declared actions a list offers", () => {
  it("offers a collection's row actions, in order, and none named for another", () => {
    expect(
      declaredRowActionsFor(CONTRIBUTIONS as never, "tickets").map(a => a.id)
    ).toEqual(["acme-support.escalate", "acme-support.preview"]);
  });

  it("offers an action on a row only where its rule holds for the row as listed", () => {
    expect(actionOfferedOn(ESCALATE, { id: "1", status: "open" })).toBe(true);
    expect(actionOfferedOn(ESCALATE, { id: "2", status: "closed" })).toBe(
      false
    );
    // A field the list did not return is one the reader may not read.
    expect(actionOfferedOn(ESCALATE, { id: "3" })).toBe(false);
    expect(actionOfferedOn(PREVIEW, { id: "4" })).toBe(true);
  });
});

describe("running a declared action", () => {
  it("calls the plugin's own route with the action, the row and the write's token", async () => {
    postSpy.mockResolvedValue({ message: "Escalated." });
    expect(
      await runDeclaredAction(ESCALATE, [{ collection: "tickets", id: "1" }])
    ).toEqual({ ran: true });
    expect(postSpy).toHaveBeenCalledWith(
      "/plugins/@acme/support/escalate",
      {
        action: "acme-support.escalate",
        rows: [{ collection: "tickets", id: "1" }],
      },
      { headers: { "x-csrf-token": "token" } }
    );
  });

  it("answers the component of one that opens, and writes nothing", async () => {
    expect(
      await runDeclaredAction(PREVIEW, [{ collection: "tickets", id: "1" }])
    ).toEqual({ open: "@acme/support/admin#Preview" });
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("the list's declared row actions", () => {
  it("gives the table each action, offered per row, and says when one ran", async () => {
    postSpy.mockResolvedValue({ message: "Escalated." });
    const { result } = renderHook(
      () => useDeclaredRowActions<{ id: string; status?: string }>("tickets"),
      { wrapper }
    );
    const [escalate, preview] = result.current.rowActions;
    expect(escalate.label).toBe("Escalate");
    expect(escalate.isVisible?.({ id: "1", status: "open" })).toBe(true);
    expect(escalate.isVisible?.({ id: "2", status: "closed" })).toBe(false);
    expect(preview.isVisible?.({ id: "2" })).toBe(true);

    await act(async () => {
      escalate.onSelect({ id: "1", status: "open" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.success).toHaveBeenCalled();
  });

  it("offers no action on a row the list returned without an id", () => {
    const { result } = renderHook(
      () => useDeclaredRowActions<{ id?: string; status?: string }>("tickets"),
      { wrapper }
    );
    expect(result.current.rowActions[0].isVisible?.({ status: "open" })).toBe(
      false
    );
  });

  it("sends nothing when an action is chosen again on a row before it answers", async () => {
    let answer: (value: unknown) => void = () => undefined;
    postSpy.mockReturnValue(new Promise(resolve => (answer = resolve)));
    const { result } = renderHook(
      () => useDeclaredRowActions<{ id: string; status?: string }>("tickets"),
      { wrapper }
    );
    const row = { id: "1", status: "open" };
    await act(async () => {
      result.current.rowActions[0].onSelect(row);
      await Promise.resolve();
      await Promise.resolve();
    });
    // Shown as busy while it runs, and a second choice sends nothing.
    expect(result.current.rowActions[0].isDisabled?.(row)).toBe(true);
    await act(async () => {
      result.current.rowActions[0].onSelect(row);
      await Promise.resolve();
    });
    expect(postSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer({ message: "Escalated." });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.rowActions[0].isDisabled?.(row)).toBe(false);
  });

  it("says the route's refusal in its own words", async () => {
    postSpy.mockRejectedValue(
      Object.assign(new Error("This action isn't available for this entry."), {
        code: "ACTION_NOT_AVAILABLE",
        status: 403,
      })
    );
    const { result } = renderHook(
      () => useDeclaredRowActions<{ id: string; status?: string }>("tickets"),
      { wrapper }
    );
    await act(async () => {
      result.current.rowActions[0].onSelect({ id: "1", status: "open" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("isn't available")
    );
  });

  it("opens the action's component with the row, and closes it", async () => {
    const { result } = renderHook(
      () => useDeclaredRowActions<{ id: string }>("tickets"),
      { wrapper }
    );
    await act(async () => {
      result.current.rowActions[1].onSelect({ id: "7" });
      await Promise.resolve();
    });
    expect(result.current.opened).toEqual({
      label: "Preview",
      component: "@acme/support/admin#Preview",
      rows: [{ collection: "tickets", id: "7" }],
    });
    act(() => result.current.close());
    expect(result.current.opened).toBeNull();
  });
});

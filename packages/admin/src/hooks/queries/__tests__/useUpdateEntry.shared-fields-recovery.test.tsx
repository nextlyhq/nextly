/**
 * A publish refused over shared values someone else published since offers to
 * take them. The author may keep editing before acting on it, so what is saved
 * as the pending change before the take is what the editor's form holds when
 * the action is taken, not the request that was refused: saving the refused
 * request and then reloading would throw away every edit made since.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { update, take, toast } = vi.hoisted(() => ({
  update: vi.fn(),
  take: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...actual, entryApi: { ...actual.entryApi, update } };
});
vi.mock("@admin/services/versionApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/versionApi")>()),
  versionApi: { takeLiveSharedValues: take },
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    defaultLocale: "en",
    getLocale: (code: string) =>
      ({ en: { label: "English" }, es: { label: "Spanish" } })[code],
  }),
}));
vi.mock("@admin/components/ui", () => ({ toast }));

import { useUpdateEntry } from "../useUpdateEntry";

/** A 409 as the API client raises it. */
function outOfDate(fields: string[]) {
  return Object.assign(new Error("Shared values were published"), {
    status: 409,
    code: "CONFLICT",
    requestId: "r1",
    data: { reason: "shared-fields-out-of-date", fields },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a publish refused over out-of-date shared fields", () => {
  it("leaves the save to the editor's form, then takes the live values into this entry's change", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    update.mockRejectedValueOnce(outOfDate(["articleCount"]));
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    const order: string[] = [];
    // The editor's form: its own Save stores the change, then the take runs.
    const form = {
      mayWrite: vi.fn(() => true),
      recover: vi.fn(async (takeAfter: () => Promise<void>) => {
        order.push("editor's Save");
        await takeAfter();
      }),
    };
    take.mockImplementation(async () => {
      order.push("take");
      return {
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      };
    });
    const { result } = renderHook(
      () =>
        useUpdateEntry({
          collectionSlug: "authors",
          entryId: "e1",
          locale: "es",
          draft: true,
          refusedForm: form,
        }),
      { wrapper: wrapper(client) }
    );

    await result.current
      .mutateAsync({
        articleCount: 3,
        bio: "As it was when refused",
        status: "published",
      })
      .catch(() => undefined);
    const [, options] = toast.error.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    options.action.onClick();
    await vi.waitFor(() => expect(take).toHaveBeenCalled());

    expect(order).toEqual(["editor's Save", "take"]);
    expect(take).toHaveBeenCalledWith(
      { kind: "collection", slug: "authors", entryId: "e1" },
      "es"
    );
    // The refused publish is the only write it made itself.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each([
    // A reader's: they may publish, but not change what the form holds.
    ["may not write", false, false],
    ["may write", true, true],
  ] as const)(
    "offers the way out only where the form %s, whatever the refused write named",
    async (_where, mayWrite, offered) => {
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      update.mockRejectedValueOnce(outOfDate(["articleCount"]));
      const form = {
        mayWrite: vi.fn(() => mayWrite),
        recover: vi.fn(async () => undefined),
      };
      const { result } = renderHook(
        () =>
          useUpdateEntry({
            collectionSlug: "authors",
            entryId: "e1",
            locale: "es",
            draft: true,
            refusedForm: form,
          }),
        { wrapper: wrapper(client) }
      );

      // A write of the status alone, as a reader's publish sends it.
      await result.current
        .mutateAsync({ status: "published" })
        .catch(() => undefined);

      // One report either way: with the action where the form could run it,
      // as any failed write is reported where it couldn't.
      expect(toast.error).toHaveBeenCalledTimes(1);
      const [, options] = toast.error.mock.calls[0] as [
        string,
        { action?: { label: string } } | undefined,
      ];
      expect(options?.action?.label).toBe(
        offered ? "Take the live values" : undefined
      );
      expect(form.recover).not.toHaveBeenCalled();
    }
  );
});

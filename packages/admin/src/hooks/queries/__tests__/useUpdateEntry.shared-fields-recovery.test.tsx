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
  it("saves what the form holds when the action is taken, not the refused request", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    update
      .mockRejectedValueOnce(outOfDate(["articleCount"]))
      .mockResolvedValue({ item: { id: "e1" } });
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    // What the form holds by the time the action is taken: the author went on
    // editing the biography after the refusal.
    const form = {
      pendingChangeNow: vi.fn(async () => ({
        articleCount: 3,
        bio: "Typed after the refusal",
      })),
      adoptTaken: vi.fn(),
      // The editor's write gate, open: the work runs as handed over.
      run: <T,>(work: () => Promise<T>) => work(),
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
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));

    expect(update.mock.calls[1]).toEqual([
      "authors",
      "e1",
      { articleCount: 3, bio: "Typed after the refusal" },
      { locale: "es", fallbackLocale: undefined },
    ]);
    // The fields taken are the ones the form then shows the live values of.
    await vi.waitFor(() =>
      expect(form.adoptTaken).toHaveBeenCalledWith(["articleCount"])
    );
  });
});

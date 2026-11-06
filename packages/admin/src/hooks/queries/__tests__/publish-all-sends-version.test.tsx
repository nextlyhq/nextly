/**
 * Publishing every language sends the version of every language.
 *
 * A publish of every language is judged on the document's own row and each
 * language's: the version it sends must name them all, which only a read of
 * every language gives. The editor reads one language, so the publish reads
 * every language first and sends that read's version.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  publishAllEntryLocales: vi.fn(),
  getDocument: vi.fn(),
  publishAllSingleLocales: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      findByID: api.findByID,
      publishAllLocales: api.publishAllEntryLocales,
    },
  };
});
vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: {
      ...actual.singleApi,
      getDocument: api.getDocument,
      publishAllLocales: api.publishAllSingleLocales,
    },
  };
});
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ locales: [] }),
}));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

import { usePublishAllLocales } from "../usePublishAllLocales";
import { usePublishAllSingleLocales } from "../usePublishAllSingleLocales";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishing every language", () => {
  it("of an entry sends the version a read of every language gives", async () => {
    api.findByID.mockResolvedValue({ id: "e1", _rev: "7.en:2,es:3" });
    api.publishAllEntryLocales.mockResolvedValue({ id: "e1" });
    const { result } = renderHook(
      () => usePublishAllLocales({ collectionSlug: "posts", silent: true }),
      { wrapper }
    );

    await result.current.mutateAsync("e1");

    expect(api.findByID).toHaveBeenCalledWith(
      "posts",
      "e1",
      expect.objectContaining({ locale: "all" })
    );
    expect(api.publishAllEntryLocales).toHaveBeenCalledWith(
      "posts",
      "e1",
      "7.en:2,es:3"
    );
  });

  it("from an editor, sends it when the language on screen is as the editor opened it", async () => {
    api.findByID.mockImplementation(
      async (_slug: string, _id: string, options: { locale?: string }) =>
        options.locale === "all"
          ? { id: "e1", _rev: "7.en:3,es:2" }
          : { id: "e1", _rev: "7.en:3" }
    );
    api.publishAllEntryLocales.mockResolvedValue({ id: "e1" });
    const { result } = renderHook(
      () =>
        usePublishAllLocales({
          collectionSlug: "posts",
          silent: true,
          shown: () => ({ version: "7.en:3", locale: "en", draft: true }),
        }),
      { wrapper }
    );

    await result.current.mutateAsync("e1");

    expect(api.findByID).toHaveBeenCalledWith(
      "posts",
      "e1",
      expect.objectContaining({ locale: "en", draft: true })
    );
    expect(api.publishAllEntryLocales).toHaveBeenCalledWith(
      "posts",
      "e1",
      "7.en:3,es:2"
    );
  });

  it("from an editor, is refused when a save lands between the two reads", async () => {
    // Every language is read first, then the language on screen: a save in
    // between makes the second read differ from what the editor opened, so
    // the publish cannot carry a change the editor never saw.
    let counter = 7;
    api.findByID.mockImplementation(
      async (_slug: string, _id: string, options: { locale?: string }) => {
        const read =
          options.locale === "all"
            ? { id: "e1", _rev: `${counter}.en:3,es:2` }
            : { id: "e1", _rev: `${counter}.en:3` };
        // A colleague saves right after this read.
        counter = 8;
        return read;
      }
    );
    const { result } = renderHook(
      () =>
        usePublishAllLocales({
          collectionSlug: "posts",
          silent: true,
          shown: () => ({ version: "7.en:3", locale: "en", draft: true }),
        }),
      { wrapper }
    );

    await expect(result.current.mutateAsync("e1")).rejects.toThrow();
    expect(api.publishAllEntryLocales).not.toHaveBeenCalled();
  });

  it("of a Single from its editor, is refused when the language on screen changed since", async () => {
    api.getDocument.mockImplementation(
      async (_slug: string, options: { locale?: string }) =>
        options.locale === "all"
          ? { id: "s1", _rev: "5.en:2,es:1" }
          : { id: "s1", _rev: "5.en:2" }
    );
    const { result } = renderHook(
      () =>
        usePublishAllSingleLocales({
          slug: "settings",
          silent: true,
          shown: () => ({ version: "4.en:1", locale: "en", draft: false }),
        }),
      { wrapper }
    );

    await expect(result.current.mutateAsync()).rejects.toThrow();
    expect(api.publishAllSingleLocales).not.toHaveBeenCalled();
  });

  it("goes unjudged, as before versions, for a caller refused the read of every language", async () => {
    // A role may publish every language yet read only some of them: the read
    // is refused, and the publish is still sent, with no version.
    api.findByID.mockImplementation(
      async (_slug: string, _id: string, options: { locale?: string }) => {
        if (options.locale === "all") {
          throw Object.assign(new Error("You may not read this document."), {
            status: 403,
            code: "FORBIDDEN",
          });
        }
        return { id: "e1", _rev: "7.en:3" };
      }
    );
    api.publishAllEntryLocales.mockResolvedValue({ id: "e1" });
    const { result } = renderHook(
      () =>
        usePublishAllLocales({
          collectionSlug: "posts",
          silent: true,
          shown: () => ({ version: "7.en:3", locale: "en", draft: true }),
        }),
      { wrapper }
    );

    await result.current.mutateAsync("e1");

    expect(api.publishAllEntryLocales).toHaveBeenCalledWith(
      "posts",
      "e1",
      undefined
    );
  });

  it("of a Single sends the version a read of every language gives", async () => {
    api.getDocument.mockResolvedValue({ id: "s1", _rev: "4.en:1,es:1" });
    api.publishAllSingleLocales.mockResolvedValue({ id: "s1" });
    const { result } = renderHook(
      () => usePublishAllSingleLocales({ slug: "settings", silent: true }),
      { wrapper }
    );

    await result.current.mutateAsync();

    expect(api.getDocument).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({ locale: "all" })
    );
    expect(api.publishAllSingleLocales).toHaveBeenCalledWith(
      "settings",
      "4.en:1,es:1"
    );
  });
});

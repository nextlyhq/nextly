/**
 * A publish of chosen parts sends the version of every language.
 *
 * It is judged on the document's own row and each language's: the version it
 * sends must name them all, which only a read of every language gives. The
 * editor reads one language, so the publish reads every language first and
 * sends that read's version, and compares the language on screen with what
 * the editor opened.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  findByID: vi.fn(),
  publishEntryParts: vi.fn(),
  getDocument: vi.fn(),
  publishSingleParts: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      findByID: api.findByID,
      publishParts: api.publishEntryParts,
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
      publishParts: api.publishSingleParts,
    },
  };
});

import {
  OVERWRITE_EVERY_LANGUAGE,
  type ShownCopy,
} from "@admin/lib/document-version";

import { usePublishParts, type PartsTarget } from "../usePublishParts";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Publishes Spanish, from an editor showing `copy` where one is given. */
function publishSpanish(target: PartsTarget, copy?: ShownCopy) {
  const { result } = renderHook(
    () =>
      usePublishParts({
        target,
        direction: "publish",
        ...(copy === undefined ? {} : { shown: () => copy }),
      }),
    { wrapper }
  );
  return result.current.mutateAsync({ locales: ["es"] });
}

const ENTRY: PartsTarget = { kind: "collection", slug: "posts", id: "e1" };
const SINGLE: PartsTarget = { kind: "single", slug: "settings" };
const ENGLISH_COPY: ShownCopy = {
  version: "7.en:3",
  locale: "en",
  draft: true,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("publishing chosen parts", () => {
  it("of an entry sends the version a read of every language gives", async () => {
    api.findByID.mockResolvedValue({ id: "e1", _rev: "7.en:2,es:3" });
    api.publishEntryParts.mockResolvedValue({ id: "e1" });

    await publishSpanish(ENTRY);

    expect(api.findByID).toHaveBeenCalledWith(
      "posts",
      "e1",
      expect.objectContaining({ locale: "all" })
    );
    expect(api.publishEntryParts).toHaveBeenCalledWith(
      "posts",
      "e1",
      "publish",
      { locales: ["es"], version: "7.en:2,es:3" }
    );
  });

  it("from an editor, sends it when the language on screen is as the editor opened it", async () => {
    api.findByID.mockImplementation(
      async (_slug: string, _id: string, options: { locale?: string }) =>
        options.locale === "all"
          ? { id: "e1", _rev: "7.en:3,es:2" }
          : { id: "e1", _rev: "7.en:3" }
    );
    api.publishEntryParts.mockResolvedValue({ id: "e1" });

    await publishSpanish(ENTRY, ENGLISH_COPY);

    expect(api.findByID).toHaveBeenCalledWith(
      "posts",
      "e1",
      expect.objectContaining({ locale: "en", draft: true })
    );
    expect(api.publishEntryParts).toHaveBeenCalledWith(
      "posts",
      "e1",
      "publish",
      { locales: ["es"], version: "7.en:3,es:2" }
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

    await expect(publishSpanish(ENTRY, ENGLISH_COPY)).rejects.toThrow(
      /changed since you opened it/
    );
    expect(api.publishEntryParts).not.toHaveBeenCalled();
  });

  it("of a Single from its editor, is refused when the language on screen changed since", async () => {
    api.getDocument.mockImplementation(
      async (_slug: string, options: { locale?: string }) =>
        options.locale === "all"
          ? { id: "s1", _rev: "5.en:2,es:1" }
          : { id: "s1", _rev: "5.en:2" }
    );

    await expect(
      publishSpanish(SINGLE, { version: "4.en:1", locale: "en", draft: false })
    ).rejects.toThrow(/changed since you opened it/);
    expect(api.publishSingleParts).not.toHaveBeenCalled();
  });

  it("chooses to overwrite for a caller refused the read of every language", async () => {
    // A role may publish yet read only some of the languages: the read is
    // refused, so the publish can carry no version of every language, and
    // says instead that it is made over whatever each holds.
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
    api.publishEntryParts.mockResolvedValue({ id: "e1" });

    await publishSpanish(ENTRY, ENGLISH_COPY);

    expect(api.publishEntryParts).toHaveBeenCalledWith(
      "posts",
      "e1",
      "publish",
      { locales: ["es"], version: OVERWRITE_EVERY_LANGUAGE }
    );
  });

  it("of a Single sends the version a read of every language gives", async () => {
    api.getDocument.mockResolvedValue({ id: "s1", _rev: "4.en:1,es:1" });
    api.publishSingleParts.mockResolvedValue({ id: "s1" });

    await publishSpanish(SINGLE);

    expect(api.getDocument).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({ locale: "all" })
    );
    expect(api.publishSingleParts).toHaveBeenCalledWith("settings", "publish", {
      locales: ["es"],
      version: "4.en:1,es:1",
    });
  });
});

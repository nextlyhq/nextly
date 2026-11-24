/**
 * The translations a publish would leave out of date, predicted: the chosen languages that others
 * were translated from are read as live and as pending, and only the fields that differ count.
 *
 * The plausible broken versions: counting every field made from a chosen language, changed or not;
 * reading a document nothing was translated from; comparing a language filled from another one;
 * counting a field already out of date again; missing a field named by its path; reading a Single
 * through the entry client; and losing the whole prediction, or waiting, on one read that fails.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";

import {
  usePredictedOutOfDate,
  type UsePredictedOutOfDateOptions,
} from "../usePredictedOutOfDate";

const api = vi.hoisted(() => ({ findByID: vi.fn(), getDocument: vi.fn() }));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: { ...actual.entryApi, findByID: api.findByID },
  };
});
vi.mock("@admin/services/singleApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/singleApi")>();
  return {
    ...actual,
    singleApi: { ...actual.singleApi, getDocument: api.getDocument },
  };
});

const madeFrom = (sourceLocale: string, outOfDate = false) => ({
  origin: "person",
  sourceLocale,
  outOfDate,
});

/** What a read names. */
interface Read {
  locale: string;
  draft: boolean;
}

/** The English copies of a post, live and pending; no other language can be read. */
const read = ({ locale, draft }: Read): Promise<Record<string, unknown>> => {
  if (locale !== "en") return Promise.reject(new Error("not readable"));
  return Promise.resolve({
    id: "post-1",
    title: draft ? "Hello again" : "Hello",
    body: "Same",
    // The same values, in another order of keys.
    seo: draft ? { text: "x", index: true } : { index: true, text: "x" },
    sections: [{ heading: draft ? "Two" : "One" }],
  });
};

const client = createTestQueryClient();

function predict(over: Partial<UsePredictedOutOfDateOptions> = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      usePredictedOutOfDate({
        target: { kind: "collection", slug: "posts", id: "post-1" },
        languages: ["en", "es", "fr"],
        chosen: ["en"],
        overview: { es: { fields: { title: madeFrom("en") } } },
        enabled: true,
        ...over,
      }),
    { wrapper }
  ).result;
}

beforeEach(() => {
  client.clear();
  api.findByID.mockReset();
  api.getDocument.mockReset();
  api.findByID.mockImplementation((_slug: string, _id: string, options: Read) =>
    read(options)
  );
  api.getDocument.mockImplementation((_slug: string, options: Read) =>
    read(options)
  );
});

describe("the translations a publish would leave out of date", () => {
  it("counts only the fields the pending change holds another value of", async () => {
    const result = predict({
      overview: {
        es: {
          fields: {
            title: madeFrom("en"),
            body: madeFrom("en"),
            seo: madeFrom("en"),
          },
        },
        fr: { fields: { body: madeFrom("en") } },
      },
    });

    await waitFor(() =>
      expect(result.current).toEqual([{ locale: "es", fields: 1 }])
    );
  });

  it("reads each copy in its language alone, filled from no other, as stored", async () => {
    const result = predict();
    await waitFor(() => expect(result.current).toHaveLength(1));

    expect(api.findByID.mock.calls.map(([, , options]) => options)).toEqual([
      { locale: "en", fallbackLocale: "none", depth: 0, draft: false },
      { locale: "en", fallbackLocale: "none", depth: 0, draft: true },
    ]);
  });

  it("compares a field named by its path by the field it is in", async () => {
    const result = predict({
      overview: {
        es: {
          fields: {
            "sections.heading": madeFrom("en"),
            "seo.text": madeFrom("en"),
          },
        },
      },
    });

    await waitFor(() =>
      expect(result.current).toEqual([{ locale: "es", fields: 1 }])
    );
  });

  it("reads nothing where no translation that is up to date was made from a chosen language", () => {
    const result = predict({
      overview: {
        es: {
          fields: { title: madeFrom("en", true), body: madeFrom("fr") },
        },
        fr: { fields: { title: { origin: "original" } } },
      },
    });

    expect(result.current).toEqual([]);
    expect(api.findByID).not.toHaveBeenCalled();
  });

  it("reads nothing while it is not asked to", () => {
    const result = predict({ enabled: false });

    expect(result.current).toEqual([]);
    expect(api.findByID).not.toHaveBeenCalled();
  });

  it("predicts nothing from a read that fails, and the rest all the same", async () => {
    const result = predict({
      chosen: ["fr", "en"],
      overview: {
        en: { fields: { body: madeFrom("fr") } },
        es: { fields: { title: madeFrom("en"), body: madeFrom("fr") } },
      },
    });

    // Both reads are done: French's failed, and English's did not.
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .map(query => query.state.status)
      ).toEqual(["error", "success"])
    );
    await waitFor(() =>
      expect(result.current).toEqual([{ locale: "es", fields: 1 }])
    );
  });

  it("reads a Single through its own client", async () => {
    const result = predict({ target: { kind: "single", slug: "banner" } });

    await waitFor(() =>
      expect(result.current).toEqual([{ locale: "es", fields: 1 }])
    );
    expect(api.getDocument).toHaveBeenCalledTimes(2);
    expect(api.findByID).not.toHaveBeenCalled();
  });
});

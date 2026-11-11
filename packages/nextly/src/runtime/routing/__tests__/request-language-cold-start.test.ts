/**
 * A `[locale]` request reaching a route before anything has started Nextly:
 * a route whose reader starts Nextly lazily, on its first read, as a site's
 * reader may. The site's languages cannot be asked before that read, so a
 * language the site has must not be answered as not found then, and one it
 * does not have must still be, once the read has started Nextly.
 *
 * The start, the registration flag and the language list are stood in for:
 * a reader's first read flips the flag, as `getNextly` registering the
 * services does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FindArgs } from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { createContentRoute } from "../content-route";
import type { NextlyContentReader } from "../resolve-content";
import {
  createPublicSingleRoute,
  type NextlySingleReader,
} from "../single-route";

const site = vi.hoisted(() => ({ started: false }));

vi.mock("../../../init", () => ({ awaitStartOrRetry: async () => undefined }));
vi.mock("../../../di/service-access", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../di/service-access")>()),
  isServicesRegistered: () => site.started,
}));
vi.mock("../../../domains/i18n/language-addresses", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/i18n/language-addresses")
  >()),
  // The site's languages, known only once Nextly has started.
  languageOfSegment: async (segment: string) =>
    site.started && (segment === "en" || segment === "de")
      ? segment
      : undefined,
}));
vi.mock("../../next-api", () => ({
  loadNextModule: () => ({
    connection: async () => undefined,
    notFound: () => {
      throw new Error("not found");
    },
    permanentRedirect: (path: string) => {
      throw new Error(`permanent redirect to ${path}`);
    },
  }),
  requireNextApi: (module: Record<string, unknown>, _: string, name: string) =>
    module[name],
}));

/** A reader that starts Nextly on its first read, recording each read. */
function lazyReader(): { nextly: NextlyContentReader; reads: FindArgs[] } {
  const reads: FindArgs[] = [];
  const nextly: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      site.started = true;
      reads.push(args);
      const items = [{ id: "1", slug: "ueber", title: "Über uns" }];
      return {
        items,
        meta: {
          total: 1,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async () => null,
  };
  return { nextly, reads };
}

function route(nextly: NextlyContentReader) {
  return createContentRoute({
    collections: ["pages"],
    nextly,
    render: (entry, context) => ({
      title: entry.title,
      locale: context.locale,
    }),
  });
}

beforeEach(() => {
  site.started = false;
});

describe("a [locale] request before Nextly has started", () => {
  it("serves a language the site has, read in it", async () => {
    const { nextly, reads } = lazyReader();

    expect(
      await route(nextly).ContentPage({
        params: { locale: "de", slug: ["ueber"] },
      })
    ).toEqual({ title: "Über uns", locale: "de" });
    expect(reads[0]?.locale).toBe("de");
  });

  it("answers not found for a language the site does not have, once the read has started it", async () => {
    const { nextly } = lazyReader();

    await expect(
      route(nextly).ContentPage({ params: { locale: "xx", slug: ["ueber"] } })
    ).rejects.toThrow("not found");
    expect(site.started).toBe(true);
  });

  it("checks the language before reading once Nextly has started", async () => {
    site.started = true;
    const { nextly, reads } = lazyReader();

    await expect(
      route(nextly).ContentPage({ params: { locale: "xx", slug: ["ueber"] } })
    ).rejects.toThrow("not found");
    expect(reads).toEqual([]);
  });
});

describe("a Single under [locale] before Nextly has started", () => {
  /** A Single reader that starts Nextly on its first read. */
  function lazySingle(): NextlySingleReader {
    return {
      findSingle: async args => {
        site.started = true;
        return { headline: "Willkommen", locale: args.locale };
      },
    } as NextlySingleReader;
  }

  function single() {
    return createPublicSingleRoute({
      slug: "home",
      nextly: lazySingle(),
      render: document => ({ headline: document.headline }),
    });
  }

  it("serves a language the site has", async () => {
    expect(await single().SinglePage({ params: { locale: "de" } })).toEqual({
      headline: "Willkommen",
    });
  });

  it("answers not found for one it does not have, once the read has started it", async () => {
    await expect(
      single().SinglePage({ params: { locale: "xx" } })
    ).rejects.toThrow("not found");
    expect(site.started).toBe(true);
  });
});

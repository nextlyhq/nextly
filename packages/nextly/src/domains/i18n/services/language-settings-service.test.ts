/**
 * What a committed language change does to the content cache. A public read made without a locale
 * is cached under its collection's or Single's tag and keyed by no locale at all, so the language
 * it serves is the default at the time it was cached; no content row is written by a language
 * change, so only the change itself can bust those tags.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { CacheRevalidator } from "../../../revalidation/types";
import {
  nextlySingleTags,
  nextlyTags,
} from "../../../runtime/cache/nextly-tags";
import type { LanguageRow } from "../language-changes";
import { LanguageRegistry } from "../language-registry";

import {
  type LanguageChangeContentCache,
  LanguageSettingsService,
} from "./language-settings-service";

const STORED: LanguageRow[] = [
  {
    code: "en",
    label: "English",
    direction: "ltr",
    fallback: "[]",
    position: 0,
    isDefault: true,
    active: true,
    revision: 1,
  },
  {
    code: "fr",
    label: "French",
    direction: "ltr",
    fallback: "[]",
    position: 1,
    isDefault: false,
    active: true,
    revision: 1,
  },
];

/**
 * An adapter whose transaction reads `STORED` and records when it commits, so a test can tell a
 * flush made after the commit from one made inside the transaction. No versions table, so a
 * default change meets no pending drafts.
 */
function fakeAdapter(events: string[]): DrizzleAdapter {
  const tx = {
    select: () => Promise.resolve(STORED.map(row => ({ ...row }))),
    insert: () => Promise.resolve(),
    update: () => Promise.resolve(),
  };
  const adapter = {
    tableExists: () => Promise.resolve(false),
    transaction: async <T>(work: (t: typeof tx) => Promise<T>): Promise<T> => {
      const result = await work(tx);
      events.push("commit");
      return result;
    },
  };
  return adapter as unknown as DrizzleAdapter;
}

/** A site with two collections and two Singles, one of each opted out of revalidation. */
function contentCache(
  revalidator: CacheRevalidator
): LanguageChangeContentCache {
  return {
    content: () =>
      Promise.resolve({
        collections: [
          { slug: "posts", revalidate: null },
          { slug: "archive", revalidate: { disable: true } },
        ],
        singles: [
          { slug: "homepage" },
          { slug: "footer", revalidate: { disable: true } },
        ],
      }),
    revalidator: () => revalidator,
  };
}

/** Every tag the revalidator was handed, across all its calls. */
const flushedTags = (flush: Mock<CacheRevalidator["flush"]>): string[] =>
  flush.mock.calls.flatMap(([intents]) =>
    intents.flatMap(intent => intent.tags)
  );

describe("LanguageSettingsService.change and the content cache", () => {
  it("flushes every collection's and Single's tag after a default change commits, skipping those opted out", async () => {
    const events: string[] = [];
    const flush = vi.fn<CacheRevalidator["flush"]>(() => {
      events.push("flush");
    });
    const service = new LanguageSettingsService(
      fakeAdapter(events),
      new LanguageRegistry({}),
      undefined,
      contentCache({ flush })
    );

    const view = await service.change({ kind: "setDefault", code: "fr" });

    expect(view.languages.find(language => language.isDefault)?.code).toBe(
      "fr"
    );
    expect(flushedTags(flush).sort()).toEqual(
      [...nextlyTags("posts"), ...nextlySingleTags("homepage")].sort()
    );
    // A default change reads the stored rows in a transaction of its own before the write's, so
    // the flush is asserted to follow the last commit, once.
    expect(events.slice(-2)).toEqual(["commit", "flush"]);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("answers with the committed list when the revalidator fails", async () => {
    const warn = vi.fn();
    const service = new LanguageSettingsService(
      fakeAdapter([]),
      new LanguageRegistry({}),
      { warn },
      contentCache({
        flush: () => Promise.reject(new Error("cache unreachable")),
      })
    );

    const view = await service.change({
      kind: "add",
      code: "de",
      label: "German",
    });

    expect(view.languages.map(language => language.code)).toEqual([
      "en",
      "fr",
      "de",
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("cache unreachable")
    );
  });

  it("flushes nothing for a change that is refused", async () => {
    const flush = vi.fn();
    const service = new LanguageSettingsService(
      fakeAdapter([]),
      new LanguageRegistry({}),
      undefined,
      contentCache({ flush })
    );

    await expect(
      service.change({ kind: "remove", code: "en" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(flush).not.toHaveBeenCalled();
  });
});

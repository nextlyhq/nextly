/**
 * A page's checks and its deletion's cleanup run one after another, so a
 * check that read the page before it was deleted cannot write its row back
 * after the cleanup removed it.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  calls: [] as string[],
  versionsRead: 0,
  failVersions: false,
}));

vi.mock("../store", async importOriginal => ({
  ...(await importOriginal<typeof import("../store")>()),
  // No row before the check; one, by the time the deletion reads.
  readVersions: async () => {
    if (store.failVersions) throw new Error("the database went away");
    store.calls.push("readVersions");
    store.versionsRead += 1;
    return store.versionsRead === 1
      ? []
      : [{ subject: { type: "posts", id: "7", label: "7" }, locale: "en" }];
  },
  savePage: async () => {
    store.calls.push("savePage");
  },
  removePage: async () => {
    store.calls.push("removePage");
    return true;
  },
  markOutOfDate: async () => {
    store.calls.push("markOutOfDate");
  },
  readPages: async () => [],
  saveSiteCheck: async () => {
    store.calls.push("saveSiteCheck");
  },
}));

import {
  checkSite,
  forgetDeleted,
  recheckSaved,
  type ProblemChecks,
} from "../check";

const CHECKS = {
  targets: ["posts"],
  readers: {},
} as unknown as ProblemChecks;

describe("a page's checks and its deletion", () => {
  it("clean up after the page's check still reading it has finished", async () => {
    let finishRead: (value: { data: unknown[] }) => void = () => undefined;
    const ctx = {
      logger: { error: vi.fn() },
      self: { collections: {} },
      publicAddresses: { defaultLanguage: async () => "en" },
      services: {
        ownCollections: {
          // The check's read of the languages the page holds, held until the
          // test lets it go.
          listEntries: () =>
            new Promise<{ data: unknown[] }>(resolve => {
              finishRead = resolve;
            }),
        },
      },
    } as unknown as PluginContext;

    recheckSaved(ctx, CHECKS, "posts", "7");
    forgetDeleted(ctx, "posts", "7");
    await vi.waitFor(() => expect(store.calls).toEqual(["readVersions"]));
    await new Promise(resolve => setTimeout(resolve, 20));
    // The cleanup has not run while the check is still reading.
    expect(store.calls).toEqual(["readVersions"]);

    finishRead({ data: [] });
    await vi.waitFor(() =>
      expect(store.calls).toEqual([
        "readVersions",
        "markOutOfDate",
        "readVersions",
        "removePage",
      ])
    );
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });

  it("fail a full check when a page's check fails, and record no check", async () => {
    store.calls = [];
    store.failVersions = true;
    const ctx = {
      logger: { error: vi.fn() },
      self: { collections: {} },
      publicAddresses: {
        types: async () => [{ kind: "collection", slug: "posts" }],
        held: async () => ({
          items: [
            {
              holder: { collection: "posts", id: "7" },
              holds: [{ locale: "en", path: "/blog/7" }],
            },
          ],
        }),
      },
    } as unknown as PluginContext;
    try {
      await expect(checkSite(ctx, CHECKS)).rejects.toThrow(
        "the database went away"
      );
      expect(store.calls).not.toContain("saveSiteCheck");
    } finally {
      store.failVersions = false;
    }
  });
});

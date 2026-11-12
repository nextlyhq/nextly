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
  failRemove: false,
}));

vi.mock("../store", async importOriginal => ({
  ...(await importOriginal<typeof import("../store")>()),
  // No row before the check; one, by the time the deletion reads.
  readVersionsOf: async () => {
    store.calls.push("readVersions");
    store.versionsRead += 1;
    // A row the page's check finds stale, where a removal is to fail.
    return store.failRemove
      ? new Map([
          [
            "7",
            [{ subject: { type: "posts", id: "7", label: "7" }, locale: "en" }],
          ],
        ])
      : new Map();
  },
  readVersions: async () => {
    store.calls.push("readVersions");
    store.versionsRead += 1;
    return [{ subject: { type: "posts", id: "7", label: "7" }, locale: "en" }];
  },
  savePage: async () => {
    store.calls.push("savePage");
  },
  removePage: async () => {
    if (store.failRemove) throw new Error("the database went away");
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
  singles: [],
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
    store.failRemove = true;
    const ctx = {
      logger: { error: vi.fn() },
      self: { collections: {} },
      services: {
        ownCollections: { listEntries: async () => ({ data: [] }) },
        collections: { listEntries: async () => ({ data: [] }) },
      },
      publicAddresses: {
        defaultLanguage: async () => "en",
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
      store.failRemove = false;
    }
  });
});

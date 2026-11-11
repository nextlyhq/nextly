/**
 * A page's checks and its deletion's cleanup run one after another, so a
 * check that read the page before it was deleted cannot write its row back
 * after the cleanup removed it.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("../store", async importOriginal => ({
  ...(await importOriginal<typeof import("../store")>()),
  readPage: async () => {
    store.calls.push("readPage");
    return undefined;
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
}));

import { forgetDeleted, recheckSaved, type ProblemChecks } from "../check";

const CHECKS = {
  targets: ["posts"],
  readers: {},
} as unknown as ProblemChecks;

describe("a page's checks and its deletion", () => {
  it("clean up after the page's check still reading it has finished", async () => {
    let finishRead: (value: { data: unknown[] }) => void = () => undefined;
    const ctx = {
      logger: { error: vi.fn() },
      services: {
        collections: {
          // The check's read of the page, held until the test lets it go.
          listEntries: () =>
            new Promise<{ data: unknown[] }>(resolve => {
              finishRead = resolve;
            }),
        },
      },
    } as unknown as PluginContext;

    recheckSaved(ctx, CHECKS, "posts", "7");
    forgetDeleted(ctx, "posts", "7");
    await vi.waitFor(() => expect(store.calls).toEqual(["readPage"]));
    await new Promise(resolve => setTimeout(resolve, 20));
    // The cleanup has not run while the check is still reading.
    expect(store.calls).toEqual(["readPage"]);

    finishRead({ data: [] });
    await vi.waitFor(() =>
      expect(store.calls).toEqual(["readPage", "markOutOfDate", "removePage"])
    );
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });
});

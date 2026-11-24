/**
 * Recording that a new site's field groups start on the current names drops the process's cached
 * registry name, which a read before the core tables existed resolved to the legacy one, whether
 * or not the record itself is written. Otherwise a failed write would leave the rest of the start
 * addressing a legacy registry the database does not have.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  settle: vi.fn(async () => {}),
  forget: vi.fn(),
}));
vi.mock("../../migration/state", async importOriginal => ({
  ...(await importOriginal<typeof import("../../migration/state")>()),
  settleMigration: calls.settle,
}));
vi.mock("../../storage/resolve-storage-names", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../storage/resolve-storage-names")
  >()),
  forgetFieldGroupStorageNames: calls.forget,
}));

import { recordNewSiteOnCurrentNames } from "../field-group-new-site";

const adapter = {} as DrizzleAdapter;
const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never;

beforeEach(() => {
  calls.settle.mockReset();
  calls.forget.mockReset();
});

describe("recording a new site on the current names", () => {
  it("drops the cached registry name once the record is written", async () => {
    calls.settle.mockResolvedValue(undefined);

    await recordNewSiteOnCurrentNames(adapter, logger);

    expect(calls.forget).toHaveBeenCalledWith(adapter);
  });

  it("drops it too when the record cannot be written", async () => {
    calls.settle.mockRejectedValue(new Error("the write failed"));

    await expect(recordNewSiteOnCurrentNames(adapter, logger)).rejects.toThrow(
      "the write failed"
    );

    expect(calls.forget).toHaveBeenCalledWith(adapter);
  });
});

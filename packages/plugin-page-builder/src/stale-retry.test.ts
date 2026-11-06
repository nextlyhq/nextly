/**
 * Writing again after a stale refusal: what is tried again, on which read,
 * and how many times.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  isStaleVersion,
  retryOnStale,
  STALE_WRITE_ATTEMPTS,
} from "./stale-retry";

const stale = (currentVersion: string) =>
  NextlyError.staleVersion({ data: { currentVersion } });

/** Reads answering 1, 2, 3, … in turn. */
function reads() {
  let version = 0;
  return vi.fn(async () => {
    version += 1;
    return version;
  });
}

describe("writing again after a stale refusal", () => {
  it("tries again on a fresh read after a stale refusal, and answers what that try answers", async () => {
    const read = reads();
    const attempt = vi
      .fn<(read: number) => Promise<string>>()
      .mockRejectedValueOnce(stale("2"))
      .mockImplementation(async from => `written from ${from}`);

    expect(await retryOnStale(read, attempt)).toBe("written from 2");
    // Each try is judged on its own read: the first, then the one after it.
    expect(attempt.mock.calls.map(call => call[0])).toEqual([1, 2]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("starts from a read already in hand, and reads only to try again", async () => {
    const read = reads();
    const attempt = vi
      .fn<(read: number) => Promise<string>>()
      .mockRejectedValueOnce(stale("8"))
      .mockResolvedValue("written");

    await retryOnStale(read, attempt, { read: 7 });
    expect(attempt.mock.calls.map(call => call[0])).toEqual([7, 1]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("throws the last stale refusal after three tries in all", async () => {
    const read = reads();
    const last = stale("4");
    const attempt = vi
      .fn<(read: number) => Promise<string>>()
      .mockRejectedValueOnce(stale("2"))
      .mockRejectedValueOnce(stale("3"))
      .mockRejectedValueOnce(last);

    await expect(retryOnStale(read, attempt)).rejects.toBe(last);
    expect(STALE_WRITE_ATTEMPTS).toBe(3);
    expect(attempt).toHaveBeenCalledTimes(3);
    // No read after the last try: nothing would be made from it.
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("does not try again after any other failure, which may have committed", async () => {
    const read = reads();
    const failures = [
      new Error("the database went away"),
      NextlyError.conflict({ reason: "state", message: "Card is locked." }),
    ];
    for (const failure of failures) {
      const attempt = vi
        .fn<(read: number) => Promise<string>>()
        .mockRejectedValue(failure);
      await expect(retryOnStale(read, attempt)).rejects.toBe(failure);
      expect(attempt).toHaveBeenCalledTimes(1);
    }
    expect(read).toHaveBeenCalledTimes(failures.length);
  });

  it("recognises a stale refusal wrapped by whatever carried it", () => {
    expect(isStaleVersion(stale("2"))).toBe(true);
    expect(
      isStaleVersion(new Error("transaction failed", { cause: stale("2") }))
    ).toBe(true);
    expect(isStaleVersion(NextlyError.conflict({ reason: "state" }))).toBe(
      false
    );
    expect(isStaleVersion("STALE_VERSION")).toBe(false);
  });
});

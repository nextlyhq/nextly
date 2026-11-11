/**
 * The start-up hook's `register()` begins Nextly's start and returns without
 * waiting for it. Next.js serves nothing until `register()` returns, so a hook
 * that waited held every request, the admin page among them, for the whole
 * start. A request that needs the database waits for that same start instead,
 * through `init/start-in-flight`.
 *
 * The registration is held open here, as a database far from the server holds
 * a real one open, so the start is still under way when `register()` must
 * already have returned.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { createRegister, shutdownNextly } from "../../init";
import { consoleLogger } from "../../shared/types";
import { awaitStartInFlight, startInFlight } from "../start-in-flight";

/** The registration each case holds open, settled by the case. */
let registration: {
  resolve: () => void;
  reject: (error: Error) => void;
} | null = null;

vi.mock("../../di/register", () => ({
  registerServices: vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        registration = { resolve, reject };
      })
  ),
  shutdownServices: vi.fn(async () => {}),
}));

const config = {} as SanitizedNextlyConfig;

/** Whether `promise` settles within `ms`, without waiting longer. */
async function settlesWithin(
  promise: Promise<unknown>,
  ms: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

afterEach(async () => {
  // A start a case left open is failed, so nothing outlives the case.
  registration?.reject(new Error("the case ended"));
  registration = null;
  await awaitStartInFlight();
  await shutdownNextly();
  vi.restoreAllMocks();
});

describe("createRegister's register()", () => {
  it("returns while the start it began is still under way", async () => {
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});

    const returned = await settlesWithin(
      createRegister(config, { cacheComponents: "true" })(),
      1_000
    );

    expect(returned, "register() returned before the start finished").toBe(
      true
    );
    // The start was begun and is the one in flight, for a request to join.
    expect(startInFlight()).not.toBeNull();
    await vi.waitFor(() => expect(registration).not.toBeNull());
  });

  it("logs a start that fails, rather than leaving a rejection nothing handles", async () => {
    const error = vi.spyOn(consoleLogger, "error").mockImplementation(() => {});

    await createRegister(config, { cacheComponents: "true" })();
    await vi.waitFor(() => expect(registration).not.toBeNull());
    registration?.reject(new Error("the database refused the connection"));
    registration = null;
    await awaitStartInFlight();

    // Vitest fails the run on an unhandled rejection, so reaching here with
    // the line logged is the evidence the failure was handled.
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("Nextly failed to start", {
        detail: "the database refused the connection",
      })
    );
  });

  it("is waited for by shutdownNextly, so a stop during the start does not leave it running", async () => {
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});

    await createRegister(config, { cacheComponents: "true" })();
    await vi.waitFor(() => expect(registration).not.toBeNull());
    const stopped = shutdownNextly();

    expect(await settlesWithin(stopped, 200), "stopped mid-start").toBe(false);
    registration?.reject(new Error("stopped"));
    registration = null;
    await stopped;
    expect(startInFlight()).toBeNull();
  });
});

describe("a reader after the start-up hook's start failed", () => {
  it("starts Nextly again, rather than refusing until something else does", async () => {
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});
    const { registerServices } = await import("../../di/register");
    const { nextly } = await import("../../direct-api/nextly");

    await createRegister(config, { cacheComponents: "true" })();
    await vi.waitFor(() => expect(registration).not.toBeNull());
    registration?.reject(new Error("the database refused the connection"));
    registration = null;
    await awaitStartInFlight();
    expect(registerServices).toHaveBeenCalledTimes(1);

    // The read makes the start again; that start fails too, and the read
    // reports why, rather than "services not initialized".
    const read = nextly.count({ collection: "posts" });
    await vi.waitFor(() => expect(registration).not.toBeNull());
    expect(registerServices).toHaveBeenCalledTimes(2);
    registration?.reject(new Error("still refused"));
    registration = null;
    await expect(read).rejects.toThrow("still refused");
  });
});

describe("shutdownNextly during a start that then fails", () => {
  it("leaves nothing for a later read to start again", async () => {
    vi.spyOn(consoleLogger, "error").mockImplementation(() => {});
    const { registerServices } = await import("../../di/register");
    const { nextly } = await import("../../direct-api/nextly");

    await createRegister(config, { cacheComponents: "true" })();
    await vi.waitFor(() => expect(registration).not.toBeNull());
    const stopped = shutdownNextly();
    registration?.reject(new Error("the database refused the connection"));
    registration = null;
    await stopped;

    // Refused as nothing started, not started again after the shutdown.
    await expect(nextly.count({ collection: "posts" })).rejects.toThrow(
      "Nextly services not initialized"
    );
    expect(registerServices).toHaveBeenCalledTimes(1);
  });
});

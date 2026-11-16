/**
 * A start resolves only once the admin-defined user fields are loaded.
 *
 * Until they are, the user services see the code's fields alone: a person is
 * read without the admin's fields, and an update to one is dropped while the
 * update reports success. A request now waits for the same start whichever
 * entry point began it, so that start, not work it leaves running, loads them.
 *
 * The step is held open here, so a start that left it running would resolve
 * while it is still held.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineConfig } from "../../collections/config/define-config";
import { getNextly, shutdownNextly } from "../../init";

/** The user-field step each case holds open, finished by the case. */
let finishFields: (() => void) | null = null;

vi.mock(
  "../../domains/users/services/provision-user-field-storage",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../domains/users/services/provision-user-field-storage")
    >()),
    provisionUserFieldStorage: vi.fn(
      () =>
        new Promise<number>(resolve => {
          finishFields = () => resolve(0);
        })
    ),
  })
);

afterEach(async () => {
  finishFields?.();
  finishFields = null;
  await shutdownNextly();
});

describe("getNextly()", () => {
  it("does not resolve while the merged user fields are still loading", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    let resolved = false;
    const starting = getNextly({ config: defineConfig({}) }).then(nextly => {
      resolved = true;
      return nextly;
    });

    await vi.waitFor(() => expect(finishFields).not.toBeNull(), {
      timeout: 30_000,
    });
    // Long enough for a start that did not wait to have resolved.
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(resolved, "resolved with the user fields still loading").toBe(false);

    finishFields?.();
    finishFields = null;
    await expect(starting).resolves.toBeDefined();
  }, 60_000);
});

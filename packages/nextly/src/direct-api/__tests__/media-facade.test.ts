/**
 * The module-level `nextly.media` facade offers every method the media
 * namespace has.
 *
 * The facade lists its delegates by name, and a method added to the namespace
 * without one is reachable from an instance and missing from `nextly`, with
 * nothing at runtime to say so until a caller trips over it. `copyOf` was
 * missing that way, so a site reader built on `getNextly()` could not ask
 * for an image's copies.
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// The facade waits for the start and checks the services are up before it
// reads the instance; both are answered here, so the instance below is the
// started one.
vi.mock("../../init", () => ({ awaitStartOrRetry: async () => undefined }));
vi.mock("../../di/service-access", () => ({
  isServicesRegistered: () => true,
}));
vi.mock("../../init/boot-migrations-gate", () => ({
  assertBootMigrationsSettled: () => undefined,
}));

import type { Nextly } from "../../init/nextly-instance";
import type { NextlyContext } from "../namespaces/context";
import { createMediaNamespace, type MediaNamespace } from "../namespaces/media";
import { nextly, resetNextlyInstance } from "../nextly";

/** Where the started instance is kept, as `requireNextly` keeps it. */
const held = globalThis as unknown as {
  __nextly_directApiInstance?: unknown;
};

describe("the nextly.media facade", () => {
  it("delegates every method of the media namespace", () => {
    const namespace = createMediaNamespace({} as NextlyContext);
    expect(Object.keys(nextly.media).sort()).toEqual(
      Object.keys(namespace).sort()
    );
  });

  it("delegates the folder methods the namespace has", () => {
    const namespace = createMediaNamespace({} as NextlyContext);
    expect(Object.keys(nextly.media.folders).sort()).toEqual(
      Object.keys(namespace.folders).sort()
    );
  });

  // The type `getNextly()` returns states the media methods by hand too, so
  // it is held to the namespace's: checked by the type checker, which runs
  // over the tests.
  it("is typed with every method of the media namespace", () => {
    expectTypeOf<keyof Nextly["media"]>().toEqualTypeOf<keyof MediaNamespace>();
    expectTypeOf<Nextly["media"]["copyOf"]>().toEqualTypeOf<
      MediaNamespace["copyOf"]
    >();
  });

  describe("copyOf", () => {
    afterEach(() => {
      resetNextlyInstance();
    });

    it("asks the started instance, with the caller's arguments", async () => {
      const copy = { url: "/api/media/m/copy/640?v=1", width: 640 };
      const copyOf = vi.fn(async () => copy);
      held.__nextly_directApiInstance = { media: { copyOf } };
      const args = { id: "m", width: 700 };
      await expect(nextly.media.copyOf(args)).resolves.toBe(copy);
      expect(copyOf).toHaveBeenCalledWith(args);
    });
  });
});

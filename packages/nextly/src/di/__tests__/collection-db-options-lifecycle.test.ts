/**
 * Collection db options live exactly as long as the registration whose config
 * declared them.
 *
 * They are process-global (`idType`, `allowIdOnCreate`), so a registration
 * with no code-first collections, or a torn-down one, must not leave an
 * earlier config's options for a later collection of the same slug — where
 * `allowIdOnCreate` decides whether a caller may choose an entry's id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { createAdapter } from "../../database/factory";
import {
  collectionDbOptions,
  publishCollectionDbOptions,
} from "../../domains/collections/services/collection-id";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { registerServices, shutdownServices } = await import("../register");

async function sqlite() {
  return createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
}

afterEach(async () => {
  await shutdownServices();
  publishCollectionDbOptions([]);
  vi.unstubAllEnvs();
});

describe("collection db options across registrations", () => {
  it("are cleared by a registration whose config declares no collections", async () => {
    vi.stubEnv("DB_DIALECT", "sqlite");
    publishCollectionDbOptions([
      { slug: "posts", db: { allowIdOnCreate: true } },
    ]);

    await registerServices({
      adapter: await sqlite(),
    } as unknown as Parameters<typeof registerServices>[0]);

    expect(collectionDbOptions("posts")).toEqual({});
  });

  it("are cleared when services shut down", async () => {
    vi.stubEnv("DB_DIALECT", "sqlite");
    await registerServices({
      adapter: await sqlite(),
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
          db: { allowIdOnCreate: true },
        }),
      ],
    } as unknown as Parameters<typeof registerServices>[0]);
    // The mechanism was reached: the registration published them.
    expect(collectionDbOptions("posts")).toEqual({ allowIdOnCreate: true });

    await shutdownServices();

    expect(collectionDbOptions("posts")).toEqual({});
  });
});

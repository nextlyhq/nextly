/**
 * The caller's own scope must arrive at the service, not merely be accepted.
 *
 * `accessOptions` is spread into each handler's argument object, and a spread
 * is exempt from TypeScript's excess-property check — so if a receiving option
 * type ever drops `authenticatedScope`, the field is discarded silently and the
 * build stays green. These assertions read what the handler was actually called
 * with, which is the only evidence that the scope travels.
 *
 * The scope under test grants `update-posts` and withholds `read-posts`, the
 * shape that leaks: its owner CAN read, so a service resolving permissions from
 * the owner answers yes to a key that was never granted the read.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { Nextly } from "../nextly";

import {
  setupTestNextly,
  resetMocks,
  type TestMocks,
} from "./helpers/test-setup";

const UPDATE_ONLY_KEY: AuthenticatedScope = {
  actorType: "apiKey",
  permissions: ["update-posts"],
};

describe("Direct API access-options forwarding", () => {
  let nextly: Nextly;
  let mocks: TestMocks;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupTestNextly();
    nextly = setup.nextly;
    mocks = setup.mocks;
    cleanup = setup.cleanup;
    resetMocks(mocks);
  });

  afterAll(() => {
    cleanup?.();
  });

  it("carries the key's own scope into a list read", async () => {
    mocks.collectionsHandler.listEntries.mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "OK",
      data: { docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 },
    });

    await nextly.find({ collection: "posts", actor: UPDATE_ONLY_KEY });

    expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: UPDATE_ONLY_KEY })
    );
  });

  it("carries the key's own scope into a by-id read", async () => {
    mocks.collectionsHandler.getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "OK",
      data: { id: "1" },
    });

    await nextly.findByID({
      collection: "posts",
      id: "1",
      actor: UPDATE_ONLY_KEY,
    });

    expect(mocks.collectionsHandler.getEntry).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: UPDATE_ONLY_KEY })
    );
  });

  it("carries the key's own scope into a count", async () => {
    mocks.collectionsHandler.countEntries.mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "OK",
      data: { count: 0 },
    });

    await nextly.count({ collection: "posts", actor: UPDATE_ONLY_KEY });

    expect(mocks.collectionsHandler.countEntries).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: UPDATE_ONLY_KEY })
    );
  });

  it("carries the key's own scope into a write", async () => {
    mocks.collectionsHandler.createEntry.mockResolvedValue({
      success: true,
      statusCode: 201,
      message: "OK",
      data: { id: "1" },
    });

    await nextly.create({
      collection: "posts",
      data: { title: "t" },
      actor: UPDATE_ONLY_KEY,
    });

    // The write path matters as much as the read: the leak is symmetric, and a
    // key whose scope is dropped on create is judged by its owner there too.
    expect(mocks.collectionsHandler.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: UPDATE_ONLY_KEY }),
      expect.anything()
    );
  });

  it("keeps the caller's access on the read-back after a where-clause update", async () => {
    mocks.collectionsHandler.bulkUpdateByQuery.mockResolvedValue({
      successCount: 1,
      successes: [{ id: "1" }],
      failures: [],
    });
    mocks.collectionsHandler.getEntry.mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "OK",
      data: { id: "1" },
    });

    await nextly.update({
      collection: "posts",
      where: { title: { equals: "t" } },
      data: { title: "u" },
      actor: UPDATE_ONLY_KEY,
      overrideAccess: false,
    });

    // The write is correctly scoped, then the result is read back through a
    // nested Direct API call. That nested call re-enters `mergeConfig`, so
    // omitting the caller's access silently restores `overrideAccess: true` and
    // hands an update-scoped key a row it has no read grant for.
    expect(mocks.collectionsHandler.getEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatedScope: UPDATE_ONLY_KEY,
        overrideAccess: false,
      })
    );
  });

  it("leaves the scope undefined for a session caller", async () => {
    mocks.collectionsHandler.listEntries.mockResolvedValue({
      success: true,
      statusCode: 200,
      message: "OK",
      data: { docs: [], totalDocs: 0, limit: 10, page: 1, totalPages: 1 },
    });

    await nextly.find({ collection: "posts" });

    // Not merely "absent": a session caller must reach the service with no
    // scope at all, so it resolves its grants the normal way. A stray empty
    // scope would read as an API key holding nothing and deny everything.
    const [call] = mocks.collectionsHandler.listEntries.mock.calls;
    expect(call[0].authenticatedScope).toBeUndefined();
  });
});

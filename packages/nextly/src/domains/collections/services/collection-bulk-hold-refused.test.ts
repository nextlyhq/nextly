/**
 * A batch whose collection's hold is refused before its first item (`COLLECTION_BEING_CHANGED`,
 * the collection held past the hold's wait by a save deleting its values) reports every requested
 * item as failed with that code, whatever `stopOnError` says, so the caller can tell the
 * collection was busy and retry each item.
 *
 * What separates the right accounting from a plausible wrong one: under `stopOnError`, a rollback
 * rewrite that only clears provisional successes reports a nonempty batch as zero successes, zero
 * failures and no errors.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../dynamic-collections/services/removed-from-code-writes", () => ({
  refuseWriteIfRemovedFromCode: async () => undefined,
}));

import { NextlyError } from "../../../errors/nextly-error";
import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../__tests__/collection-test-helpers";

import type { CollectionAccessService } from "./collection-access-service";
import { CollectionBulkService } from "./collection-bulk-service";
import type { CollectionMutationService } from "./collection-mutation-service";
import type { CollectionQueryService } from "./collection-query-service";

/** A bulk service whose entry transaction is refused before any item runs, as a held collection's is. */
function refusedAtTheHold() {
  const refusal = new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection is being changed elsewhere. Try again in a moment.",
  });
  const mutation = {
    resolveTransitionAuthorization: vi.fn(async () => undefined),
    warmLocalizedReadiness: vi.fn(async () => undefined),
    // The registry row the batch is made for, read before its transaction opens.
    loadedRegistryRowFor: vi.fn(async () => undefined),
    entryTransaction: vi.fn(async () => {
      throw refusal;
    }),
  };
  const access = { checkCollectionAccess: vi.fn(async () => null) };
  return new CollectionBulkService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    access as unknown as CollectionAccessService,
    {} as CollectionQueryService,
    mutation as unknown as CollectionMutationService
  );
}

describe("a batch refused at its collection's hold", () => {
  for (const stopOnError of [true, false]) {
    it(`reports every item failed with the refusal's code (stopOnError ${String(stopOnError)})`, async () => {
      const result = await refusedAtTheHold().createEntries(
        { collectionName: "posts", overrideAccess: true },
        [{ title: "a" }, { title: "b" }],
        { stopOnError }
      );

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.errors.map(e => [e.index, e.code])).toEqual([
        [0, "COLLECTION_BEING_CHANGED"],
        [1, "COLLECTION_BEING_CHANGED"],
      ]);
    });
  }
});

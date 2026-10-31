/**
 * Reading the server's refusal of a write to a collection or Single removed
 * from code.
 *
 * The server answers every such write with 409 `ENTITY_REMOVED_FROM_CODE`, a
 * sentence that names the entity and both ways out, and `{ kind, slug }`. Two
 * things follow on this side: the sentence is shown as it is, and the
 * entity's schema is read again, since a screen opened before the removal
 * still holds a schema that says it may be edited.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import {
  refreshRemovedFromCodeSchema,
  removedFromCodeRefusal,
} from "../removed-from-code-refusal";
import { collectionKeys } from "../useCollections";
import { singleKeys } from "../useSingles";

const SENTENCE =
  'The collection "posts" was removed from code, so its entries can\'t be ' +
  "changed. To retire it, run `nextly migrate:create` and then " +
  "`nextly migrate`. To keep it, declare it again in nextly.config.ts.";

function refusal(
  data: Record<string, unknown> | null = {
    kind: "collection",
    slug: "posts",
  },
  status = 409,
  code = "ENTITY_REMOVED_FROM_CODE"
) {
  return parseApiError(
    { error: { code, message: SENTENCE, data, requestId: "req-1" } },
    status
  );
}

describe("removedFromCodeRefusal", () => {
  it("answers the server's sentence for the refusal", () => {
    expect(removedFromCodeRefusal(refusal())).toBe(SENTENCE);
  });

  it("answers nothing for any other refusal", () => {
    // A conflict of another kind, and the same code on another status: the
    // contract is the pair, so neither is read as this refusal.
    expect(
      removedFromCodeRefusal(refusal(undefined, 409, "CONFLICT"))
    ).toBeNull();
    expect(removedFromCodeRefusal(refusal(undefined, 403))).toBeNull();
  });

  it("answers nothing for a failure that never reached the server", () => {
    expect(removedFromCodeRefusal(new TypeError("Failed to fetch"))).toBeNull();
    expect(removedFromCodeRefusal("refused")).toBeNull();
    expect(removedFromCodeRefusal(undefined)).toBeNull();
  });
});

describe("refreshRemovedFromCodeSchema", () => {
  function client() {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    return { queryClient, invalidate };
  }

  it("reads every collection query again for a removed collection", () => {
    const { queryClient, invalidate } = client();

    expect(refreshRemovedFromCodeSchema(queryClient, refusal())).toBe(true);

    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: collectionKeys.all(),
    });
  });

  it("reads every Single query again for a removed Single", () => {
    const { queryClient, invalidate } = client();

    expect(
      refreshRemovedFromCodeSchema(
        queryClient,
        refusal({ kind: "single", slug: "home" })
      )
    ).toBe(true);

    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: singleKeys.all(),
    });
  });

  it("reads both again when the refusal does not say which kind", () => {
    const { queryClient, invalidate } = client();

    // No data at all: an older server, or a proxy that kept only the code.
    expect(refreshRemovedFromCodeSchema(queryClient, refusal(null))).toBe(true);

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: collectionKeys.all(),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: singleKeys.all() });
  });

  it("reads nothing again for any other failure", () => {
    const { queryClient, invalidate } = client();

    expect(
      refreshRemovedFromCodeSchema(
        queryClient,
        refusal(undefined, 409, "CONFLICT")
      )
    ).toBe(false);
    expect(
      refreshRemovedFromCodeSchema(queryClient, new TypeError("offline"))
    ).toBe(false);

    expect(invalidate).not.toHaveBeenCalled();
  });
});

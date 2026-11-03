/**
 * How a duplicate reads its source: as the caller's own read of every
 * lifecycle state, so a draft it may read can be copied, with the read gate
 * left to the query service and the copy made only after that read succeeds.
 *
 * The behaviour over a real database, every caller kind included, is in
 * `src/auth/__tests__/route-authorized-writes.integration.test.ts`; this file
 * pins the request the service makes and the order it makes it in.
 */

import { describe, it, expect, vi } from "vitest";

import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../__tests__/collection-test-helpers";

import type { CollectionAccessService } from "./collection-access-service";
import { CollectionBulkService } from "./collection-bulk-service";
import type { CollectionMutationService } from "./collection-mutation-service";
import type { CollectionQueryService } from "./collection-query-service";
import type { CollectionServiceResult } from "./collection-types";

type GetEntry = CollectionQueryService["getEntry"];
type CreateEntry = CollectionMutationService["createEntry"];

/** The service over a recorded read and create, the read answering `source`. */
function build(source: CollectionServiceResult) {
  const getEntry = vi.fn<GetEntry>().mockResolvedValue(source);
  const createEntry = vi.fn<CreateEntry>().mockResolvedValue({
    success: true,
    statusCode: 201,
    message: "Created",
    data: { id: "copy" },
  });
  const service = new CollectionBulkService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    {} as CollectionAccessService,
    { getEntry } as unknown as CollectionQueryService,
    { createEntry } as unknown as CollectionMutationService
  );
  return { service, getEntry, createEntry };
}

const DRAFT: CollectionServiceResult = {
  success: true,
  statusCode: 200,
  message: "Found",
  data: { id: "src", title: "Draft", status: "draft" },
};

describe("duplicateEntry source read", () => {
  it("reads the source as the caller, in every lifecycle state, and copies it", async () => {
    const { service, getEntry, createEntry } = build(DRAFT);
    const user = { id: "editor-1" };

    const result = await service.duplicateEntry({
      collectionName: "pages",
      entryId: "src",
      user,
      overrideAccess: false,
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(getEntry).toHaveBeenCalledTimes(1);
    const read = getEntry.mock.calls[0]?.[0];
    expect(read).toMatchObject({
      collectionName: "pages",
      entryId: "src",
      user,
      overrideAccess: false,
      status: "all",
    });
    // The route attested the create, never the read, so the read is checked.
    expect(read).not.toHaveProperty("routeAuthorized");
    // The live row is copied, never a pending working draft.
    expect(read).not.toHaveProperty("includeWorkingDraft");
    expect(createEntry.mock.calls[0]?.[1]).toMatchObject({
      title: "Draft (Copy)",
      status: "draft",
    });
  });

  it("creates nothing when the caller's read of the source is refused", async () => {
    const { service, createEntry } = build({
      success: false,
      statusCode: 404,
      message: "Entry not found",
      data: null,
    });

    const result = await service.duplicateEntry({
      collectionName: "pages",
      entryId: "src",
      user: { id: "editor-1" },
      overrideAccess: false,
    });

    expect(result.statusCode).toBe(404);
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("keeps a trusted read unbounded, and a bounded trusted read status-less", async () => {
    const unbounded = build(DRAFT);
    await unbounded.service.duplicateEntry({
      collectionName: "pages",
      entryId: "src",
      overrideAccess: true,
    });
    expect(unbounded.getEntry.mock.calls[0]?.[0].status).toBe("all");

    // A bound the read cannot tell from one the caller asked for: a
    // manufactured "all" would carry drafts of refused targets into the copy.
    const bounded = build(DRAFT);
    await bounded.service.duplicateEntry({
      collectionName: "pages",
      entryId: "src",
      overrideAccess: true,
      trusted: collection => collection === "pages",
    });
    expect(bounded.getEntry.mock.calls[0]?.[0].status).toBeUndefined();
  });
});

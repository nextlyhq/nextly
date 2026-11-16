/**
 * The published schema DELETE handlers (`nextly/api/collections-schema-detail`
 * and `nextly/api/singles-schema-detail`) expire the cached reads of what they
 * delete. They call the registry's delete directly, past the metadata
 * services, so the expiry has to live in that delete for them to get it.
 *
 * The route's permission check is the only thing replaced: what is under test
 * is the delete behind it, on a real boot with a recording revalidator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/route-auth", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../api/route-auth")>()),
  requireRouteAllPermissions: vi.fn(async () => undefined),
}));
// The handlers wait for the app's own boot first; the test boot below is it.
vi.mock("../../../init", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../init")>()),
  getCachedNextly: vi.fn(async () => undefined),
}));

import { DELETE as deleteCollectionRoute } from "../../../api/collections-schema-detail";
import { DELETE as deleteSingleRoute } from "../../../api/singles-schema-detail";
import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleMetadataService } from "../../singles/services/single-metadata-service";

/** Records every intent flushed to it. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

let handle: TestNextly | undefined;
let spy: RecordingRevalidator;

beforeEach(async () => {
  spy = new RecordingRevalidator();
  // Registered before boot, so registerServices keeps it rather than the no-op.
  container.registerSingleton<CacheRevalidator>("cacheRevalidator", () => spy);
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
  handle = await createTestNextly({ adapter, collections: [] });
});

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** A DELETE as the route receives it, for `slug`. */
function deleteRequest(path: string, slug: string) {
  return [
    new Request(`http://localhost/admin/api/${path}/${slug}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ slug }) },
  ] as const;
}

async function adminCollection(slug: string, revalidate?: false) {
  const collections: CollectionsHandler =
    handle!.getService("collectionsHandler");
  const created = await collections.createCollection({
    name: slug,
    label: slug,
    fields: [{ name: "title", type: "text" }],
    ...(revalidate === false ? { revalidate } : {}),
  });
  expect(created.success, JSON.stringify(created)).toBe(true);
}

async function adminSingle(slug: string, revalidate?: { disable: true }) {
  await (
    handle!.getService(
      "singleMetadataService" as never
    ) as unknown as SingleMetadataService
  ).createSingle({
    slug,
    label: slug,
    tableName: `single_${slug}`,
    fields: [{ name: "headline", type: "text" }],
    source: "ui",
    locked: false,
    schemaHash: `published-delete-${slug}`,
    schemaVersion: 1,
    ...(revalidate ? { revalidate } : {}),
  } as never);
}

describe("the published collection DELETE", () => {
  it("expires every cached read of the collection it deletes", async () => {
    await adminCollection("notes");
    spy.flushed.length = 0;

    const response = await deleteCollectionRoute(
      ...deleteRequest("collections/schema", "notes")
    );
    expect(response.status).toBe(204);
    expect(spy.tags).toContain("nextly:notes");
  });

  it("expires nothing for a collection that opts out", async () => {
    await adminCollection("drafts", false);
    spy.flushed.length = 0;

    const response = await deleteCollectionRoute(
      ...deleteRequest("collections/schema", "drafts")
    );
    expect(response.status).toBe(204);
    expect(spy.tags).toEqual([]);
  });
});

describe("the published Single DELETE", () => {
  it("expires every cached read of the Single it deletes", async () => {
    await adminSingle("banner");
    spy.flushed.length = 0;

    const response = await deleteSingleRoute(
      ...deleteRequest("singles/schema", "banner")
    );
    expect(response.status).toBe(204);
    expect(spy.tags).toContain("nextly:single:banner");
  });

  it("expires nothing for a Single that opts out", async () => {
    await adminSingle("notice", { disable: true });
    spy.flushed.length = 0;

    const response = await deleteSingleRoute(
      ...deleteRequest("singles/schema", "notice")
    );
    expect(response.status).toBe(204);
    expect(spy.tags).toEqual([]);
  });
});

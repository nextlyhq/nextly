/**
 * The whole point of this PR: a version list is reachable through the same
 * catch-all API the admin calls, not only through the standalone route exports.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { parseRestRoute } from "../../../route-handler/route-parser";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("version history through the dispatcher (integration)", () => {
  it("routes an entry's version list to the version method", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "v1" }
    );
    const id = (created.data as { id: string }).id;

    // The admin's URL shape resolves to the version method with the right ids.
    const parsed = parseRestRoute(
      ["collections", "posts", "entries", id, "versions"],
      "GET"
    );

    expect(parsed).toMatchObject({
      service: "collections",
      method: "listEntryVersions",
      routeParams: { collectionName: "posts", entryId: id },
    });
  });

  it("routes a Single's version list without needing an entry id in the URL", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "settings",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const parsed = parseRestRoute(["singles", "settings", "versions"], "GET");

    // The id is resolved server-side from the live row, so the URL carries
    // only the slug.
    expect(parsed).toMatchObject({
      service: "singles",
      method: "listSingleVersions",
      routeParams: { slug: "settings" },
    });
  });
});

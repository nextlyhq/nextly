/**
 * A collection created BEFORE its name became a reserved system-resource name
 * (e.g. `settings`, `media`) must stay editable: the reserved-slug guard in the
 * registry has to grandfather a no-op slug on an update while still refusing a
 * create or a rename ONTO a reserved slug.
 *
 * Regression: `updateCollectionMetadata` passes the collection's existing slug
 * into `ensureGlobalSlugUniqueness` on every metadata/field/status change, so an
 * unconditional reserved-slug throw there made pre-reservation collections
 * permanently uneditable.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { Logger } from "../../../../services/shared";
import { DynamicCollectionRegistryService } from "../dynamic-collection-registry-service";

let current: TestNextly | undefined;

// createCollection only runs the generated migration (and creates the row) in
// development.
let prevNodeEnv: string | undefined;
beforeEach(() => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  process.env.NODE_ENV = prevNodeEnv;
});

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createCollection: (data: Record<string, unknown>) => Promise<{
      success: boolean;
    }>;
  };
}

function registryOf(t: TestNextly): DynamicCollectionRegistryService {
  const logger = t.getService("logger") as Logger;
  return new DynamicCollectionRegistryService(t.adapter, logger);
}

async function slugRow(
  t: TestNextly,
  slug: string
): Promise<{ slug: string; description: unknown } | undefined> {
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
  };
  const rows = await adapter.executeQuery(
    `SELECT slug, description FROM dynamic_collections WHERE slug='${slug}'`
  );
  return rows[0] as { slug: string; description: unknown } | undefined;
}

describe("grandfathered reserved-name collection stays editable (integration)", () => {
  it("allows a metadata update that keeps a now-reserved slug it already owns", async () => {
    current = await createTestNextly({ collections: [] });

    // Create a normal collection, then rename its stored slug to a reserved
    // name to simulate a collection that predates the reservation (the create
    // path itself refuses reserved names).
    const created = await handlerOf(current).createCollection({
      name: "prefs",
      label: "Prefs",
      fields: [{ name: "body", type: "text" }],
    });
    expect(created.success).toBe(true);

    const rawAdapter = current.adapter as unknown as {
      executeQuery: (sql: string) => Promise<Record<string, unknown>[]>;
    };
    await rawAdapter.executeQuery(
      `UPDATE dynamic_collections SET slug='settings' WHERE slug='prefs'`
    );

    // The metadata update keeps the reserved slug it already owns, so the guard
    // must allow it rather than throw reserved_slug.
    await expect(
      registryOf(current).updateCollectionMetadata("settings", {
        description: "grandfathered edit",
      })
    ).resolves.toBeDefined();

    const row = await slugRow(current, "settings");
    expect(row?.description).toBe("grandfathered edit");
  });

  it("still rejects renaming a collection onto a reserved slug it does not own", async () => {
    current = await createTestNextly({ collections: [] });

    const created = await handlerOf(current).createCollection({
      name: "posts",
      label: "Posts",
      fields: [{ name: "body", type: "text" }],
    });
    expect(created.success).toBe(true);

    // A rename TARGETS a reserved slug the collection does not already own, so
    // the guard must still refuse it.
    await expect(
      registryOf(current).updateCollectionMetadata("posts", { slug: "media" })
    ).rejects.toThrow(NextlyError);

    // The rename was refused, so the collection keeps its original slug and no
    // `media` row was created.
    expect(await slugRow(current, "posts")).toBeDefined();
    expect(await slugRow(current, "media")).toBeUndefined();
  });
});

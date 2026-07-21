/**
 * Restore against a real database.
 *
 * The unit tests pin the decisions; this pins the thing they cannot — that a
 * snapshot resubmitted through the normal update path actually lands, and that
 * the restore is itself recorded as a version pointing back at its source.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { restoreVersion } from "../restore-version";
import type { VersionsService } from "../versions-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const superAdmin = { id: "tester", roles: ["super-admin"] };

async function bootPosts(): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({
        slug: "posts",
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
}

describe("restoreVersion (integration)", () => {
  it("puts the document back to an earlier version's content", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second" }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: superAdmin,
    });

    const after = await handler.getEntry({
      collectionName: "posts",
      entryId,
      overrideAccess: true,
      status: "all",
    });

    expect((after.data as { title?: string }).title).toBe("First");
  });

  it("records the restore as a new version pointing at its source", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second" }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: superAdmin,
    });

    const history = await versions.list({
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId,
    });

    // History grows rather than being rewritten, so the pre-restore state is
    // still there and a wrong restore is undone by restoring again.
    expect(history.length).toBe(3);

    const newest = history[0];
    expect(newest?.sourceVersionNo).toBe(1);
  });

  it("keeps the replaced version even under a tight retention cap", async () => {
    // The confirm dialog tells the editor a restore can be undone. The
    // retention pass runs with the restore's own capture, and at a tight cap it
    // would otherwise remove exactly the version holding the replaced content —
    // taking the undo away the moment it was promised.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          versions: { enabled: true, maxPerDoc: 1 },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second" }
    );

    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: "posts",
      entryId,
    };
    // The cap has already trimmed history to the head, so that head is the only
    // version there is to restore.
    const head = (await versions.list(ref))[0];
    expect(head?.versionNo).toBeDefined();

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: head!.versionNo!,
      user: superAdmin,
    });

    const history = await versions.list(ref);

    // The replaced content survives its own restore's retention pass.
    expect(history.some(v => v.versionNo === head!.versionNo)).toBe(true);
  });

  it("leaves history intact when a restore is repeated", async () => {
    current = await bootPosts();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const versions = current.getService<VersionsService>("versionsService");

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const entryId = (created.data as { id: string }).id;

    await handler.updateEntry(
      { collectionName: "posts", entryId, overrideAccess: true },
      { title: "Second" }
    );

    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 1,
      user: superAdmin,
    });
    // Undo the restore by restoring the version it replaced.
    await restoreVersion({
      scopeKind: "collection",
      slug: "posts",
      entryId,
      versionNo: 2,
      user: superAdmin,
    });

    const after = await handler.getEntry({
      collectionName: "posts",
      entryId,
      overrideAccess: true,
      status: "all",
    });
    const history = await versions.list({
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId,
    });

    expect((after.data as { title?: string }).title).toBe("Second");
    expect(history.length).toBe(4);
  });
});

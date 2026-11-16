/**
 * A publish that carries a pending draft's fields judges each of them with the field rules
 * evaluated on the document the publish produces, not on the draft alone.
 *
 * A rule reads the document's other fields. `guarded` may be written only where `kind` is
 * `"public"`. A draft that set `kind` to `"private"` and changed `guarded`, published with `kind`
 * set back to `"public"`, produces a document whose rule allows `guarded`, so the publish succeeds.
 * Judged on the draft alone, the rule read `"private"` and refused it. The other way round, a
 * publish that turns `kind` to `"private"` produces a document whose rule denies the pending
 * `guarded`, so it is refused and nothing is written.
 *
 * @module domains/collections/__tests__/publish-judges-pending-by-produced-document.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const SLUG = "kindguard";
const PUBLISHER = { id: "publisher", email: "publisher@x.test", roles: [] };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Published `{ kind: "public", guarded: "old" }`, with drafts on, and a trusted pending draft. */
async function boot(
  dialect: TestDialect,
  pending: { kind: string; guarded: string }
): Promise<{ t: TestNextly; h: CollectionsHandler; id: string }> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
        },
        fields: [
          text({ name: "kind" }),
          text({
            name: "guarded",
            access: {
              update: ({ data }) =>
                (data as { kind?: unknown } | undefined)?.kind === "public",
            },
          }),
        ],
      }),
    ],
  });
  await userWhoMay(current, PUBLISHER.id, "update", [SLUG]);
  await grantTo(current, PUBLISHER.id, "publish", [SLUG]);
  const h = current.getService("collectionsHandler") as CollectionsHandler;
  const created = await h.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { kind: "public", guarded: "old", status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;

  // A trusted writer's save with no status, held as the pending draft.
  const held = await h.updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true },
    { ...pending, _overwrite: true }
  );
  expect(held.success, JSON.stringify(held)).toBe(true);
  // POPULATION CONTROL: the draft is pending and live still holds the old values.
  expect(await read(current, id, true)).toMatchObject(pending);
  expect(await read(current, id, false)).toMatchObject({
    kind: "public",
    guarded: "old",
  });
  return { t: current, h, id };
}

/** The entry's `kind` and `guarded`, live or as the pending draft holds them. */
async function read(
  t: TestNextly,
  id: string,
  draft: boolean
): Promise<{ kind?: unknown; guarded?: unknown }> {
  const doc = (await t.nextly.findByID({
    collection: SLUG as never,
    id,
    overrideAccess: true,
    ...(draft ? { draft: true } : {}),
  } as never)) as { kind?: unknown; guarded?: unknown } | null;
  return { kind: doc?.kind, guarded: doc?.guarded };
}

/** PUBLISHER's publish, sending `kind` with the status. */
function publishWith(h: CollectionsHandler, id: string, kind: string) {
  return h.updateEntry(
    {
      collectionName: SLUG,
      entryId: id,
      routeAuthorized: true,
      user: PUBLISHER,
    },
    { kind, status: "published", _overwrite: true }
  );
}

describe.each(getConfiguredTestDialects())(
  "a publish judges a pending draft by the document it produces (%s)",
  dialect => {
    it("publishes a pending value the produced document allows, though the draft alone denied it", async () => {
      const { t, h, id } = await boot(dialect, {
        kind: "private",
        guarded: "new",
      });

      const published = await publishWith(h, id, "public");

      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(await read(t, id, false)).toEqual({
        kind: "public",
        guarded: "new",
      });
    });

    it("refuses a publish whose produced document denies a pending value the draft allowed, writing nothing", async () => {
      const { t, h, id } = await boot(dialect, {
        kind: "public",
        guarded: "new",
      });

      const refused = await publishWith(h, id, "private");

      expect(refused.success).toBe(false);
      const issues = (
        refused as {
          publicData?: { errors?: Array<{ path: string; code: string }> };
        }
      ).publicData?.errors;
      expect(issues?.map(i => i.path)).toEqual(["guarded"]);
      expect(issues?.[0]?.code).toBe("FORBIDDEN");
      expect(await read(t, id, false)).toEqual({
        kind: "public",
        guarded: "old",
      });
    });
  }
);

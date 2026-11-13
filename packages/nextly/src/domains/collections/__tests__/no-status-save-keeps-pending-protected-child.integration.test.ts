/**
 * A save with no status, made while another editor's draft is pending, keeps that draft's value of
 * each group child the saver may not write.
 *
 * A group is stored whole, so a save that sends it replaces the pending one. The field rules put a
 * child the saver may not write back at a stored value before that, and that value was the LIVE
 * one, so the saver's save reverted the other editor's pending edit of the child. The save keeps
 * the pending value instead, and saves the rest of the group. A child counts as changed only when
 * the saver sends a value that is neither the live one nor the pending one; that save is refused,
 * as a change to a field the saver may not write.
 *
 * @module domains/collections/__tests__/no-status-save-keeps-pending-protected-child.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, group, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

const SLUG = "pendchild";
/** May write the group's protected child. */
const AUTHOR = { id: "author", email: "author@x.test", roles: [] };
/** May not. */
const EDITOR = { id: "editor", email: "editor@x.test", roles: [] };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Published, drafts on, a group holding a child anyone may write and one only AUTHOR may. */
async function boot(dialect: TestDialect): Promise<{
  t: TestNextly;
  h: CollectionsHandler;
  id: string;
}> {
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
          text({ name: "body" }),
          group({
            name: "ops",
            fields: [
              text({ name: "note" }),
              text({
                name: "runbook",
                access: {
                  update: ({ req }) => req.user?.email === AUTHOR.email,
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
  for (const who of [AUTHOR, EDITOR]) {
    await userWhoMay(current, who.id, "update", [SLUG]);
    await grantTo(current, who.id, "publish", [SLUG]);
  }
  const h = current.getService("collectionsHandler") as CollectionsHandler;
  const created = await h.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    {
      body: "live",
      ops: { note: "live-note", runbook: "live-runbook" },
      status: "published",
    }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  return { t: current, h, id: (created.data as { id: string }).id };
}

/** A save with no status, as `who`. */
function saveAs(
  h: CollectionsHandler,
  id: string,
  who: typeof AUTHOR,
  data: Record<string, unknown>
) {
  return h.updateEntry(
    { collectionName: SLUG, entryId: id, routeAuthorized: true, user: who },
    { ...data, _overwrite: true }
  );
}

/** The group as the pending draft holds it. */
async function pendingOps(t: TestNextly, id: string): Promise<unknown> {
  const draft = (await t.nextly.findByID({
    collection: SLUG as never,
    id,
    draft: true,
    overrideAccess: true,
  } as never)) as { ops?: unknown } | null;
  return draft?.ops;
}

/** The group as the live row holds it. */
async function liveOps(t: TestNextly, id: string): Promise<unknown> {
  const live = (await t.nextly.findByID({
    collection: SLUG as never,
    id,
    overrideAccess: true,
  } as never)) as { ops?: unknown } | null;
  return live?.ops;
}

/** AUTHOR's pending draft, which changes the protected child. */
async function authorDraft(h: CollectionsHandler, t: TestNextly, id: string) {
  const held = await saveAs(h, id, AUTHOR, {
    ops: { note: "live-note", runbook: "author-runbook" },
  });
  expect(held.success, JSON.stringify(held)).toBe(true);
  // POPULATION CONTROL: the edit is pending and the live row still holds the old value, so a
  // later "the draft holds AUTHOR's value" is about the draft.
  expect(await pendingOps(t, id)).toEqual({
    note: "live-note",
    runbook: "author-runbook",
  });
  expect(await liveOps(t, id)).toEqual({
    note: "live-note",
    runbook: "live-runbook",
  });
}

describe.each(getConfiguredTestDialects())(
  "a save with no status over another editor's pending draft (%s)",
  dialect => {
    it("keeps the pending value of the child the saver may not write, and saves the rest", async () => {
      const { t, h, id } = await boot(dialect);
      await authorDraft(h, t, id);

      // EDITOR read the draft, and sends the group back with the child it may write changed.
      const saved = await saveAs(h, id, EDITOR, {
        ops: { note: "editor-note", runbook: "author-runbook" },
      });

      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(await pendingOps(t, id)).toEqual({
        note: "editor-note",
        runbook: "author-runbook",
      });
      expect(await liveOps(t, id)).toEqual({
        note: "live-note",
        runbook: "live-runbook",
      });
    });

    it("keeps the pending value when the saver sends the live value it loaded before", async () => {
      const { t, h, id } = await boot(dialect);
      await authorDraft(h, t, id);

      // EDITOR loaded the entry before AUTHOR saved, so its group carries the live value.
      const saved = await saveAs(h, id, EDITOR, {
        ops: { note: "editor-note", runbook: "live-runbook" },
      });

      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(await pendingOps(t, id)).toEqual({
        note: "editor-note",
        runbook: "author-runbook",
      });
    });

    it("refuses a save that changes the child to a third value, changing nothing", async () => {
      const { t, h, id } = await boot(dialect);
      await authorDraft(h, t, id);

      const refused = await saveAs(h, id, EDITOR, {
        ops: { note: "editor-note", runbook: "editor-runbook" },
      });

      expect(refused.success).toBe(false);
      const issues = (
        refused as {
          publicData?: { errors?: Array<{ path: string; code: string }> };
        }
      ).publicData?.errors;
      expect(issues?.map(i => i.path)).toEqual(["ops.runbook"]);
      expect(issues?.[0]?.code).toBe("FORBIDDEN");
      expect(await pendingOps(t, id)).toEqual({
        note: "live-note",
        runbook: "author-runbook",
      });
    });
  }
);

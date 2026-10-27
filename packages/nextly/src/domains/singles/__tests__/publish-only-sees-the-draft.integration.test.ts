/**
 * Who is shown a Single's pending change: a caller who may put it live sees
 * it, as one who may edit the Single does; one whose publish rule refuses
 * them, or who may only read, sees the live Single.
 *
 * @module domains/singles/__tests__/publish-only-sees-the-draft.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const SLUG = "draftedsite";
/** The same, with a publish rule that refuses every caller. */
const GUARDED = "guardedsite";
/** May update and publish: writes the draft. */
const EDITOR = { id: "editor-1", email: "editor@x.test", roles: [] };
/** May publish, and holds no update. */
const PUBLISHER = { id: "publisher-1", email: "publisher@x.test", roles: [] };
/** May read, and neither update nor publish. */
const READER = { id: "reader-1", email: "reader@x.test", roles: [] };

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<SingleEntryService> {
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "siteName" })],
      }),
      defineSingle({
        slug: GUARDED,
        status: true,
        versions: { drafts: true },
        access: { publish: () => false },
        fields: [text({ name: "siteName" })],
      }),
    ],
  });
  const both = [SLUG, GUARDED];
  await userWhoMay(current, EDITOR.id, "update", both);
  for (const action of ["read", "publish"]) {
    await grantTo(current, EDITOR.id, action, both);
  }
  await userWhoMay(current, PUBLISHER.id, "publish", both);
  await grantTo(current, PUBLISHER.id, "read", both);
  await userWhoMay(current, READER.id, "read", both);
  return current.getService("singleEntryService");
}

/** Publishes the Single live, then holds an editor's change as its draft. */
async function heldDraft(
  singles: SingleEntryService,
  slug: string
): Promise<void> {
  await singles.update(
    slug,
    { siteName: "Live", status: "published" },
    { overrideAccess: true }
  );
  const held = await singles.update(
    slug,
    { siteName: "Finished draft" },
    { routeAuthorized: true, user: EDITOR }
  );
  expect(held.success, JSON.stringify(held)).toBe(true);
}

/** What `user` reads of the Single, asking for its pending change. */
async function readAs(
  singles: SingleEntryService,
  slug: string,
  user: { id: string; email: string; roles: never[] }
): Promise<Record<string, unknown>> {
  const read = await singles.get(slug, {
    user,
    overrideAccess: false,
    includeWorkingDraft: true,
  });
  return (read.data ?? {}) as Record<string, unknown>;
}

describe.each(getConfiguredTestDialects())(
  "who is shown a Single's pending change (%s)",
  dialect => {
    it("shows it to a caller who may publish the Single", async () => {
      const singles = await boot(dialect);
      await heldDraft(singles, SLUG);
      const read = await readAs(singles, SLUG, PUBLISHER);
      expect(read.siteName).toBe("Finished draft");
      expect(read._isWorkingDraft).toBe(true);
    });

    it("hides it from a caller whose publish rule refuses the Single", async () => {
      const singles = await boot(dialect);
      await heldDraft(singles, GUARDED);
      const read = await readAs(singles, GUARDED, PUBLISHER);
      expect(read.siteName).toBe("Live");
      expect(read._isWorkingDraft).toBeUndefined();
      // POPULATION CONTROL: the editor, who may update, is shown it.
      expect((await readAs(singles, GUARDED, EDITOR)).siteName).toBe(
        "Finished draft"
      );
    });

    it("hides it from a caller who may only read", async () => {
      const singles = await boot(dialect);
      await heldDraft(singles, SLUG);
      const read = await readAs(singles, SLUG, READER);
      expect(read.siteName).toBe("Live");
      expect(read._isWorkingDraft).toBeUndefined();
    });
  }
);

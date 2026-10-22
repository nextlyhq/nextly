/**
 * A Single's discard removes the draft of the document it was checked
 * against, and only that one.
 *
 * The checks before a discard are made against one Single document, named by
 * its id. A Single deleted and made again between those checks and the delete
 * is a different document, and its draft is not the one the caller was
 * allowed to discard. The delete is therefore bound to the id that was checked,
 * and refused when the Single's row is no longer that document.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineSingle, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { discardWorkingDraft } from "../discard-working-draft";

const SETTINGS = "discard_identity_settings";

describe.each(getConfiguredTestDialects())(
  "a Single's discard is bound to the document it was checked against (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let liveId: string;

    const ref = () => ({
      scopeKind: "single" as const,
      scopeSlug: SETTINGS,
      entryId: liveId,
    });

    async function draftParts(): Promise<(string | null)[]> {
      return t.getService("versionsService").listWorkingDraftParts(ref());
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        singles: [
          defineSingle({
            slug: SETTINGS,
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "siteName" })],
          }),
        ],
      });
      const trusted = new Nextly();
      await trusted.updateSingle({
        slug: SETTINGS,
        data: { siteName: "Acme", status: "published" },
      });
      await trusted.updateSingle({
        slug: SETTINGS,
        data: { siteName: "Acme (pending)" },
      });
      const live = (await trusted.findSingle({ slug: SETTINGS })) as {
        id: string;
      };
      liveId = String(live.id);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("refuses, keeping the draft, when the checked id is not the Single's row", async () => {
      expect((await draftParts()).length).toBeGreaterThan(0);
      await expect(
        discardWorkingDraft({
          scopeKind: "single",
          slug: SETTINGS,
          entryId: "a-document-no-longer-there",
          user: { id: "system-check", roles: ["super-admin"] },
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await draftParts()).length).toBeGreaterThan(0);
    });

    it("removes the draft of the Single it was checked against", async () => {
      const { removed } = await discardWorkingDraft({
        scopeKind: "single",
        slug: SETTINGS,
        entryId: liveId,
        user: { id: "system-check", roles: ["super-admin"] },
      });
      expect(removed).toBe(1);
      expect(await draftParts()).toEqual([]);
    });
  }
);

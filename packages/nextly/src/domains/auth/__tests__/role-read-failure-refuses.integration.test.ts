/**
 * An access check whose role read fails refuses, instead of judging the
 * caller as holding no roles.
 *
 * The rules here allow unless the caller holds a role, the shape for which
 * "no roles" and "the roles could not be read" give opposite answers: judged
 * on an empty role set, such a rule allows. That is the separating condition,
 * because a rule that asks for a role denies either way, and a test written
 * with one passes whether or not the read failure is handled.
 *
 * The role read is made to fail for real, on every dialect, by renaming the
 * table it reads (`user_roles`) out from under a booted instance. Each case
 * reads as a person who was never looked up before, so no cached answer
 * stands in for the read. The control case reads with the table in place and
 * shows the rule runs and allows.
 *
 * The gate refuses before any field rule runs, so a field rule's own answer
 * to the same failure is pinned where it can be reached:
 * `shared/lib/__tests__/field-rule-grants-unreadable.test.ts`.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { Nextly, nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  clearInMemoryPermissionTiersForTests,
  invalidateAllPermissionCaches,
} from "../../../services/lib/permissions";

/** A rule that allows unless the caller holds the `suspended` role. */
const UNLESS_SUSPENDED = ({ roles }: { roles: string[] }) =>
  !roles.includes("suspended");

const ROLES_TABLE = "user_roles";

describe.each(getConfiguredTestDialects())(
  "a rule that allows unless a role is held, when the roles cannot be read (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let people = 0;

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "notes",
            fields: [text({ name: "title" })],
            access: { read: UNLESS_SUSPENDED, create: () => true },
          }),
        ],
      });
      await nextly.create({ collection: "notes", data: { title: "a note" } });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** A person with no roles, never looked up before, read as by REST. */
    async function newReader(): Promise<Nextly> {
      people += 1;
      const created = await nextly.users.create({
        email: `reader${people}@${dialect}.test`,
        password: "Password123!",
        data: { name: `Reader ${people}`, isActive: true },
      });
      const id = String((created.item as { id: string }).id);
      // No earlier answer may stand in for the read under test.
      clearInMemoryPermissionTiersForTests();
      await invalidateAllPermissionCaches();
      return new Nextly({ overrideAccess: false, user: { id } });
    }

    /** Runs `work` with the role table out of reach, and puts it back. */
    async function withRolesUnreadable<T>(work: () => Promise<T>): Promise<T> {
      const away = `${ROLES_TABLE}_unreadable`;
      await t.adapter.executeQuery(
        `ALTER TABLE ${ROLES_TABLE} RENAME TO ${away}`
      );
      try {
        return await work();
      } finally {
        await t.adapter.executeQuery(
          `ALTER TABLE ${away} RENAME TO ${ROLES_TABLE}`
        );
      }
    }

    it("allows, with the roles readable: the rule runs and finds no suspended role", async () => {
      const reader = await newReader();

      const notes = await reader.find({ collection: "notes" });

      expect(notes.items.map(n => n.title)).toEqual(["a note"]);
    });

    it("refuses the collection's read rather than allowing it", async () => {
      const reader = await newReader();

      const outcome = await withRolesUnreadable(() =>
        reader.find({ collection: "notes" }).then(
          found => ({ refused: false as const, found }),
          (error: unknown) => ({ refused: true as const, error })
        )
      );

      expect(outcome.refused).toBe(true);
      // An internal error, the read having failed for no reason a caller can act on.
      expect(outcome.refused && (outcome.error as { code?: string }).code).toBe(
        "INTERNAL_ERROR"
      );
    });
  }
);

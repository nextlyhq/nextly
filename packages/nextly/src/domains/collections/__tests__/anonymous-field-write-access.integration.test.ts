/**
 * Field-level write rules apply to an ANONYMOUS write, not only an
 * authenticated one.
 *
 * The write guard used to read `overrideAccess || !user`, treating "no user" as
 * a trusted system write. The read guard has only ever read `overrideAccess`.
 * On a collection that permits anonymous creates — an ordinary supported config
 * for a contact form or a public submission — that asymmetry let an
 * unauthenticated writer set a field EVERY authenticated user is forbidden from
 * setting. Less authentication bought more authority.
 *
 * The two cases here are one experiment: the authenticated arm is the control
 * that makes the anonymous arm mean something. Without it, "the field was
 * written" is equally consistent with "the rule was never registered" — which
 * is exactly how the first version of this probe reported no defect at all.
 *
 * @module domains/collections/__tests__/anonymous-field-write-access.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "notes";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          text({
            name: "secret",
            // Refused to everyone. The rule names BOTH operations: a create
            // consults `access.create`, and declaring only `update` leaves a
            // create ungated — which is how a first attempt at this test
            // reported both writers behaving identically.
            access: { create: () => false, update: () => false },
          } as never),
        ],
      }),
    ],
  });
  return current;
}

/**
 * The stored `secret` of the row with this title.
 *
 * Throws when the row is absent, rather than reporting `null`. A create that
 * failed outright leaves no row, and a helper that answered `null` for that
 * would make every "the field was stripped" assertion below pass through a
 * COMPLETELY broken anonymous-create path — green for the opposite of the
 * reason it claims.
 */
const storedSecret = async (
  t: TestNextly,
  title: string
): Promise<string | null> => {
  const rows = await t.adapter.select<{ title: string; secret?: string }>(
    `dc_${SLUG}`,
    {}
  );
  const row = rows.find(r => r.title === title);
  if (row === undefined) {
    throw new Error(
      `no row titled "${title}": the write was refused, not stripped`
    );
  }
  return row.secret ?? null;
};

describe.each(getConfiguredTestDialects())(
  "field write rules and the anonymous writer (%s)",
  dialect => {
    it("strips a refused field from an AUTHENTICATED write", async () => {
      // The control. If this ever stops holding, the case below proves nothing:
      // an unstripped anonymous write would be indistinguishable from a rule
      // that was never registered.
      const t = await boot(dialect);
      const created = await (
        t.getService("collectionsHandler") as CollectionsHandler
      ).createEntry(
        {
          collectionName: SLUG,
          user: { id: "u1", roles: ["editor"] },
        } as never,
        { title: "auth", secret: "SET-BY-AUTH" }
      );

      expect(created.success).toBe(true);
      expect(await storedSecret(t, "auth")).toBeNull();
    });

    it("strips it from an ANONYMOUS write too", async () => {
      // The defect. A collection may legitimately allow anonymous creates, and
      // the REST path reaches this with no user at all: the dispatcher forwards
      // `userId: p._authenticatedUserId`, which is undefined when nobody is
      // signed in, and never passes `overrideAccess`.
      const t = await boot(dialect);
      const created = await (
        t.getService("collectionsHandler") as CollectionsHandler
      ).createEntry(
        { collectionName: SLUG },
        { title: "anon", secret: "SET-BY-ANON" }
      );

      expect(created.success).toBe(true);
      expect(await storedSecret(t, "anon")).toBeNull();
    });

    it("still lets a TRUSTED write set it", async () => {
      // The other control, and the reason the fix drops only `|| !user`. An
      // explicit `overrideAccess` is a deliberate statement by an internal
      // writer that it is trusted; that bypass is intact, and it is the one a
      // seeder or migration actually uses.
      const t = await boot(dialect);
      const created = await (
        t.getService("collectionsHandler") as CollectionsHandler
      ).createEntry(
        { collectionName: SLUG, overrideAccess: true },
        { title: "trusted", secret: "SET-BY-SYSTEM" }
      );

      expect(created.success).toBe(true);
      expect(await storedSecret(t, "trusted")).toBe("SET-BY-SYSTEM");
    });
  }
);

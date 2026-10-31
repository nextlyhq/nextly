/**
 * A plugin's call made as a user inside `ctx.services.collections.withTransaction`
 * is judged by the roles its transaction sees.
 *
 * The caller a plugin's `as: "user"` names is built with its roles, and a field
 * rule reads them as `req.user.roles`. Inside a transaction those roles must be
 * read on it: read on the pool, they are another connection's view, blind to a
 * role the transaction took away, and on PostgreSQL and MySQL each lookup is a
 * statement escaping the transaction, which the suite's escape check refuses.
 *
 * The transaction is the one the plugin facade's `withTransaction` opens. The
 * collection service under the facade is wrapped only to keep a hold of it, so
 * the test can take a role away on it, as a hook or a later step of the same
 * work would.
 */
import { createHash } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../config";
import type { CollectionService } from "../../domains/collections/services/collection-service";
import type { AccessRuleContext } from "../../shared/types/access";
import type { AuthUserId } from "../../types/auth";
import { wrapCollectionsForPlugin } from "../service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const NOTES = "rolenotes";
const AUTHOR = "role-author";

/** The slug `grantTo` gives the role holding `action` for `userId`. */
const roleSlugOf = (action: string, userId: string) =>
  `may-${action}-${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`;

/** The role the guarded field asks for: the author's read role. */
const TRUSTED = roleSlugOf("read", AUTHOR);

/** Admits a caller whose request user holds {@link TRUSTED}. */
const holdsTrustedRole = ({ req }: AccessRuleContext) =>
  (
    (req.user as { roles?: unknown } | undefined)?.roles as string[] | undefined
  )?.includes(TRUSTED) === true;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: NOTES,
        access: { create: () => true, read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "guarded", access: { update: holdsTrustedRole } }),
        ],
      }),
    ],
  });
  return current;
}

/**
 * The author, who may update notes and holds {@link TRUSTED}, with one note
 * whose guarded field reads "before".
 */
async function seedAuthor(t: TestNextly) {
  await userWhoMay(t, AUTHOR, "update", [NOTES]);
  await grantTo(t, AUTHOR, "read", [NOTES]);
  const created = (await t.nextly.create({
    collection: NOTES,
    data: { title: "note", guarded: "before" },
  })) as unknown as { item: { id: string } };
  const roles = (await t.nextly.roles.find({ limit: 200 })) as unknown as {
    items: { id: string; slug: string }[];
  };
  const trusted = roles.items.find(role => role.slug === TRUSTED);
  if (!trusted) throw new Error(`[test] No role "${TRUSTED}".`);
  return {
    id: created.item.id,
    trustedRoleId: trusted.id,
    user: {
      id: AUTHOR as AuthUserId,
      email: `${AUTHOR}@example.test`,
      name: AUTHOR,
    },
  };
}

/**
 * The plugin facade over the instance's collection service, and the
 * transaction its `withTransaction` opened last.
 */
function pluginCollections(t: TestNextly) {
  const service = t.getService("collectionService") as CollectionService;
  const opened: { tx?: TransactionContext } = {};
  const kept = new Proxy(service, {
    get(target, prop, receiver) {
      if (prop === "withTransaction") {
        return <T>(work: (tx: TransactionContext) => Promise<T>) =>
          target.withTransaction(tx => {
            opened.tx = tx;
            return work(tx);
          });
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { collections: wrapCollectionsForPlugin(kept), opened };
}

/** The guarded field as stored. */
async function guardedOf(t: TestNextly, id: string): Promise<unknown> {
  const found = (await t.nextly.findByID({ collection: NOTES, id })) as {
    guarded?: unknown;
  };
  return found.guarded;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's call as a user inside its transaction (%s)",
  dialect => {
    it("writes the guarded field for a user whose role the transaction keeps", async () => {
      // The control: the fixture reaches the rule, which admits the role.
      const t = await boot(dialect);
      const { id, user } = await seedAuthor(t);
      const { collections } = pluginCollections(t);

      await collections.withTransaction(tx =>
        collections.updateEntryInTransaction(
          tx,
          NOTES,
          id,
          { guarded: "after" },
          { as: "user", user }
        )
      );

      expect(await guardedOf(t, id)).toBe("after");
    });

    it("refuses the guarded field to a user whose role the transaction took away", async () => {
      const t = await boot(dialect);
      const { id, trustedRoleId, user } = await seedAuthor(t);
      const { collections, opened } = pluginCollections(t);

      await collections.withTransaction(async tx => {
        if (!opened.tx) throw new Error("[test] No transaction was opened.");
        await opened.tx.delete("user_roles", {
          and: [
            { column: "userId", op: "=", value: AUTHOR },
            { column: "roleId", op: "=", value: trustedRoleId },
          ],
        });
        await collections.updateEntryInTransaction(
          tx,
          NOTES,
          id,
          { guarded: "after", title: "edited" },
          { as: "user", user }
        );
      });

      // The rest of the write went through; only the guarded field was kept.
      const stored = (await t.nextly.findByID({ collection: NOTES, id })) as {
        title?: unknown;
      };
      expect(stored.title).toBe("edited");
      expect(await guardedOf(t, id)).toBe("before");
    });

    it("refuses the guarded field outside a transaction to a user without the role", async () => {
      // The same rule outside any transaction, for a user who never held the
      // role: the refusal above is the rule's, not the transaction's.
      const t = await boot(dialect);
      const { id } = await seedAuthor(t);
      await userWhoMay(t, "role-other", "update", [NOTES]);
      const { collections } = pluginCollections(t);

      await collections.updateEntry(
        NOTES,
        id,
        { guarded: "after" },
        {
          as: "user",
          user: {
            id: "role-other" as AuthUserId,
            email: "role-other@example.test",
          },
        }
      );

      expect(await guardedOf(t, id)).toBe("before");
    });
  }
);

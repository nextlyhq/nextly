/**
 * A collection write made inside a caller's own transaction reads through that
 * transaction.
 *
 * `createEntryInTransaction`, `updateEntryInTransaction` and the bulk create
 * and update take the caller's transaction and write on it. Every read they
 * make on the way has to be made on it too: the caller's grants a field rule
 * is judged by, the component schemas an update held as a pending change is
 * split by, the collection gate. A read made on the pool instead is another
 * connection's view, blind to what the transaction has already changed, and
 * on a pool of one connection it waits for the connection the transaction
 * holds and never gets it.
 *
 * Two properties, then, each on every write:
 * - on a pool of one connection, the write completes;
 * - a role the transaction took away is gone for the write: its field rule
 *   refuses the field the role admitted, and the rest of the write lands.
 *
 * PostgreSQL and MySQL are the evidence: a pool read there waits on the pool
 * and cannot see the transaction's uncommitted delete. SQLite has one
 * connection, so both properties hold there whatever the write reads on; its
 * leg is the control that the fixture reaches each path.
 *
 * @module domains/collections/__tests__/write-in-caller-transaction-reads-through-it.integration.test
 */
import { createHash } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { AccessRuleContext } from "../../../shared/types/access";

/** No pending changes: a write lands on the row, where it can be read back. */
const NOTES = "txrnotes";
/** Drafts and a component: an update of a published entry is held. */
const HELD = "txrheld";
const HERO = "txrhero";
const AUTHOR = "txr-author";
const USER = { id: AUTHOR, email: `${AUTHOR}@example.test` };

/** The slug `grantTo` gives the role holding `action` for `userId`. */
const roleSlugOf = (action: string, userId: string) =>
  `may-${action}-${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`;

/** The role the guarded field asks for: the author's read role. */
const TRUSTED = roleSlugOf("read", AUTHOR);

/**
 * Admits a caller holding {@link TRUSTED}. `roles` is the caller's grants,
 * looked up from the database for the write, so the rule answers by the
 * roles the lookup saw.
 */
const holdsTrustedRole = ({ roles }: AccessRuleContext) =>
  roles.includes(TRUSTED);

/**
 * The pool size the run was started with, put back after each case: a case
 * that sets its own must not leave it for the next file in this worker.
 */
const CALLERS_POOL_MAX = process.env.DB_POOL_MAX;

let current: TestNextly | undefined;
afterEach(async () => {
  const instance = current;
  current = undefined;
  if (CALLERS_POOL_MAX === undefined) delete process.env.DB_POOL_MAX;
  else process.env.DB_POOL_MAX = CALLERS_POOL_MAX;
  if (!instance) return;
  // Bounded, so a write still waiting on the pool does not hold the file; a
  // teardown that fails or runs out the bound fails the case rather than
  // leaving an instance behind unremarked.
  await within(instance.destroy(), 10_000);
});

/**
 * `work`, or a rejection once `ms` pass: on a pool of one, a read that waits
 * for a second connection never settles, and the test fails rather than hangs.
 */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not settle within ${ms} ms`)),
      ms
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const guarded = () =>
    text({
      name: "guarded",
      access: { create: holdsTrustedRole, update: holdsTrustedRole },
    });
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({ slug: HERO, fields: [text({ name: "heading" })] }),
    ],
    collections: [
      defineCollection({
        slug: NOTES,
        access: { create: () => true, read: () => true, update: () => true },
        fields: [text({ name: "title" }), guarded()],
      }),
      defineCollection({
        slug: HELD,
        status: true,
        versions: { drafts: true },
        access: { create: () => true, read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          guarded(),
          fieldGroup({ name: "hero", component: HERO }),
        ],
      }),
    ],
  });
  // The author may create, read and update both, and holds TRUSTED.
  await userWhoMay(current, AUTHOR, "update", [NOTES, HELD]);
  await grantTo(current, AUTHOR, "create", [NOTES, HELD]);
  await grantTo(current, AUTHOR, "read", [NOTES, HELD]);
  return current;
}

function entriesOf(t: TestNextly): CollectionEntryService {
  return (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** An entry of `slug` written with no caller, its id. */
async function seeded(
  t: TestNextly,
  slug: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await entriesOf(t).createEntry(
    { collectionName: slug, overrideAccess: true },
    data
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  return (created.data as { id: string }).id;
}

async function stored(
  t: TestNextly,
  slug: string,
  id: string
): Promise<Record<string, unknown>> {
  const read = await entriesOf(t).getEntry({
    collectionName: slug,
    entryId: id,
    overrideAccess: true,
  });
  return (read.data ?? {}) as Record<string, unknown>;
}

/**
 * TRUSTED's id, looked up before any transaction opens: a lookup made inside
 * one, on the pool, would be the test's own escape, which the suite's escape
 * check reports as the write's.
 */
async function trustedRoleId(t: TestNextly): Promise<string> {
  const roles = (await t.nextly.roles.find({ limit: 200 })) as unknown as {
    items: { id: string; slug: string }[];
  };
  const trusted = roles.items.find(role => role.slug === TRUSTED);
  if (!trusted) throw new Error(`[test] No role "${TRUSTED}".`);
  return trusted.id;
}

/** Takes the role `roleId` away from the author, on `tx`. */
async function takeRoleAway(tx: TransactionContext, roleId: string) {
  await tx.delete("user_roles", {
    and: [
      { column: "userId", op: "=", value: AUTHOR },
      { column: "roleId", op: "=", value: roleId },
    ],
  });
}

/**
 * One write made inside a caller's transaction, through each entry point. It
 * writes `data` to `slug` as the author and answers the id it wrote to and
 * whether the write said it succeeded.
 */
interface Write {
  name: string;
  /** Seeds what the write needs, before the transaction opens. */
  prepare(t: TestNextly, slug: string): Promise<string | undefined>;
  run(
    t: TestNextly,
    tx: TransactionContext,
    slug: string,
    data: Record<string, unknown>,
    existing: string | undefined
  ): Promise<{ id: string; ok: boolean; detail: unknown }>;
}

const WRITES: Write[] = [
  {
    name: "createEntryInTransaction",
    prepare: () => Promise.resolve(undefined),
    async run(t, tx, slug, data) {
      const result = await entriesOf(t).createEntryInTransaction(
        tx,
        { collectionName: slug, user: USER },
        data
      );
      return {
        id: (result.data as { id?: string } | null)?.id ?? "",
        ok: result.success,
        detail: result,
      };
    },
  },
  {
    name: "updateEntryInTransaction",
    prepare: (t, slug) =>
      seeded(t, slug, {
        title: "before",
        guarded: "before",
        ...(slug === HELD ? { status: "published" } : {}),
      }),
    async run(t, tx, slug, data, existing) {
      const id = existing ?? "";
      const result = await entriesOf(t).updateEntryInTransaction(
        tx,
        { collectionName: slug, entryId: id, user: USER },
        { ...data, _overwrite: true }
      );
      return { id, ok: result.success, detail: result };
    },
  },
  {
    name: "createEntriesInTransaction",
    prepare: () => Promise.resolve(undefined),
    async run(t, tx, slug, data) {
      const result = await entriesOf(t).createEntriesInTransaction(
        tx,
        { collectionName: slug, user: USER },
        [data]
      );
      return {
        id: result.ids[0] ?? "",
        ok: result.successful === 1 && result.failed === 0,
        detail: result,
      };
    },
  },
  {
    name: "updateEntriesInTransaction",
    prepare: (t, slug) =>
      seeded(t, slug, {
        title: "before",
        guarded: "before",
        ...(slug === HELD ? { status: "published" } : {}),
      }),
    async run(t, tx, slug, data, existing) {
      const id = existing ?? "";
      const result = await entriesOf(t).updateEntriesInTransaction(
        tx,
        { collectionName: slug, user: USER },
        [{ id, data: { ...data, _overwrite: true } }]
      );
      return {
        id,
        ok: result.successful === 1 && result.failed === 0,
        detail: result,
      };
    },
  },
];

describe.each(getConfiguredTestDialects())(
  "a collection write inside a caller's transaction (integration, %s)",
  dialect => {
    // On a published entry of a collection with drafts, an update is held as
    // a pending change, and holding it reads the component's schema: the
    // update entry points reach that read here, the creates the rest.
    it.each(WRITES)(
      "$name completes on a pool of one connection",
      async write => {
        // One connection: the caller's transaction holds it, so a read that
        // asks the pool from inside waits for ever. Read at boot.
        process.env.DB_POOL_MAX = "1";
        const t = await boot(dialect);
        const existing = await write.prepare(t, HELD);

        const written = await within(
          t.adapter.transaction(tx =>
            write.run(
              t,
              tx,
              HELD,
              { title: "after", guarded: "after", hero: { heading: "Hi" } },
              existing
            )
          ),
          15_000
        );

        expect(written.ok, JSON.stringify(written.detail)).toBe(true);
      },
      60_000
    );

    // The control: the author holding the role writes the guarded field, so
    // the refusal below is the role's absence, and the fixture reaches the
    // rule on every entry point.
    it.each(WRITES)(
      "$name writes the guarded field for an author whose role the transaction keeps",
      async write => {
        const t = await boot(dialect);
        const existing = await write.prepare(t, NOTES);

        const written = await t.adapter.transaction(tx =>
          write.run(
            t,
            tx,
            NOTES,
            { title: "after", guarded: "after" },
            existing
          )
        );

        expect(written.ok, JSON.stringify(written.detail)).toBe(true);
        expect(await stored(t, NOTES, written.id)).toMatchObject({
          title: "after",
          guarded: "after",
        });
      },
      60_000
    );

    it.each(WRITES)(
      "$name refuses the guarded field once the transaction took the role away",
      async write => {
        const t = await boot(dialect);
        const existing = await write.prepare(t, NOTES);
        const trusted = await trustedRoleId(t);

        const written = await t.adapter.transaction(async tx => {
          await takeRoleAway(tx, trusted);
          return write.run(
            t,
            tx,
            NOTES,
            { title: "after", guarded: "after" },
            existing
          );
        });

        // The rest of the write went through; the guarded field did not.
        expect(written.ok, JSON.stringify(written.detail)).toBe(true);
        const row = await stored(t, NOTES, written.id);
        expect(row.title).toBe("after");
        expect(row.guarded ?? null).toBe(existing ? "before" : null);
      },
      60_000
    );
  }
);

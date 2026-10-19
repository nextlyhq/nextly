/**
 * Deleting a staff user erases the email delivery records that name them,
 * under every address they used, on every configured dialect.
 *
 * Core's emails to a staff user name them on the record by kind and id. Their
 * deletion erases every record that names them, whatever address it went to,
 * and replaces their id with the keyed digest the deleted-people list keeps.
 * A record written for them afterwards (a send that was in flight, a retry, a
 * provider's later report) is written erased. The erasure by current address
 * still runs, for records that name nobody, and never reaches a record that
 * names someone else.
 *
 * @module domains/users/__tests__/delete-user-erases-by-person.integration.test
 */

// Read through the env proxy by the address digest and the digest key: set
// before either is imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Hooks into the deleted-people lock: run once when the next deletion asks for
 * it exclusively, and once after the next write naming a person holds it
 * shared, then cleared. They let a race be held at the contested lock instead
 * of after a pause, so a test tells the locking order apart from one that
 * merely ran in time.
 */
const digestLock = vi.hoisted(() => ({
  beforeExclusive: undefined as (() => void) | undefined,
  afterShared: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("../../audit/principal-digest", async importOriginal => {
  const real =
    await importOriginal<typeof import("../../audit/principal-digest")>();
  return {
    ...real,
    readPrincipalDigests: async (
      ...args: Parameters<typeof real.readPrincipalDigests>
    ) => {
      const mode = args[3];
      if (mode === "exclusive") {
        const hook = digestLock.beforeExclusive;
        digestLock.beforeExclusive = undefined;
        hook?.();
      }
      const digests = await real.readPrincipalDigests(...args);
      if (mode === "shared") {
        const hook = digestLock.afterShared;
        digestLock.afterShared = undefined;
        await hook?.();
      }
      return digests;
    },
  };
});

import { NextlyError } from "../../../errors";
import { runPostInitTasks } from "../../../init/post-init-tasks";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import { staffPerson } from "../../../plugins/principals/ref";
import type { PrincipalRef } from "../../../plugins/principals/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  buildAuditLogWriter,
  type AuditEvent,
} from "../../audit/audit-log-writer";
import { resealPrincipalDigestKeyAtBoot } from "../../audit/erase-principal";
import { deliveriesTableFor } from "../../email/deliveries-table";
import {
  ERASED_RECIPIENT_HASH,
  recipientDigest,
} from "../../email/delivery-record";
import { defineEmailProvider } from "../../email/provider-definition";
import { pruneEmailData } from "../../email/prune";
import { EmailDeliveryService } from "../../email/services/email-delivery-service";

/** A delivery row as read back (Drizzle camelCases the columns). */
interface DeliveryRow {
  id: string;
  recipientHash: string;
  principalKind: string | null;
  principalId: string | null;
}

const DIGEST = /^[0-9a-f]{64}$/;
const quiet = { info() {}, warn() {}, error() {}, debug() {} } as never;

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;
// Run by the capturing mailer as it accepts a message, so a test can change
// the database between the provider accepting the message and its record.
let duringSend: (() => Promise<void>) | undefined;

afterEach(async () => {
  digestLock.beforeExclusive = undefined;
  digestLock.afterShared = undefined;
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  duringSend = undefined;
});

/** A provider that accepts every message, and a plugin kind of person. */
const mailer = definePlugin({
  name: "members",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    principals: [
      {
        name: "member",
        attributes: { verified: "boolean" },
        resolve: async () => null,
        lookup: async (id: string) => ({ id, attributes: { verified: true } }),
      },
    ],
    emailProviders: [
      defineEmailProvider<{ apiKey: string }>({
        type: "capturing-mailer",
        label: "Capturing Mailer",
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "password",
            required: true,
            secret: true,
          },
        ],
        parseConfig: (input: unknown) => {
          const config = input as { apiKey?: unknown };
          if (typeof config.apiKey !== "string" || !config.apiKey) {
            throw NextlyError.validation({
              errors: [
                {
                  path: "configuration.apiKey",
                  code: "INVALID_PROVIDER_CONFIG",
                  message: "API key is required",
                },
              ],
            });
          }
          return { apiKey: config.apiKey };
        },
        createAdapter: () => ({
          send: async () => {
            await duringSend?.();
            return { success: true, messageId: "captured" };
          },
        }),
      }),
    ],
  },
  init(context: PluginContext) {
    ctx = context;
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [mailer] });
  if (!ctx) throw new Error("the plugin's init did not run");
  await runPostInitTasks();
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-mailer",
      fromEmail: "from@example.com",
      configuration: { apiKey: "throwaway-test-key" },
      isDefault: true,
    },
  });
  return current;
}

let serial = 0;

/** A staff user at `email`. */
async function staffUser(t: TestNextly, email: string): Promise<string> {
  serial += 1;
  const id = `erased-staff-${serial}`;
  await t.adapter.insert("users", {
    id,
    email,
    name: "Staff",
    email_verified: null,
    is_active: true,
    password_hash:
      "$2a$10$abcdefghijklmnopqrstuuJ7rOq0r9rUuJ1yYb1E5vZ3QhJcI2xyK",
    created_at: new Date(),
    updated_at: new Date(),
  });
  return id;
}

function moveTo(t: TestNextly, id: string, email: string): Promise<unknown> {
  return t.nextly.users.update({ id, data: { email } });
}

function remove(t: TestNextly, id: string): Promise<unknown> {
  return t.nextly.users.delete({ id });
}

/** Email `to`, naming `person` when given. */
function email(
  t: TestNextly,
  to: string,
  person?: PrincipalRef
): Promise<unknown> {
  return t.nextly.email.send({
    to,
    subject: "Hello",
    html: "<p>hi</p>",
    ...(person ? { person } : {}),
  });
}

function rows(t: TestNextly): Promise<DeliveryRow[]> {
  return t.adapter.select<DeliveryRow>("email_deliveries");
}

async function added(
  t: TestNextly,
  write: () => Promise<unknown>
): Promise<DeliveryRow[]> {
  const before = new Set((await rows(t)).map(row => row.id));
  await write();
  return (await rows(t)).filter(row => !before.has(row.id));
}

async function row(t: TestNextly, id: string): Promise<DeliveryRow> {
  const found = (await rows(t)).find(candidate => candidate.id === id);
  if (!found) throw new Error(`no delivery row ${id}`);
  return found;
}

/** Every value in every column of every delivery row, as text. */
async function everyStoredValue(t: TestNextly): Promise<string[]> {
  const all =
    await t.adapter.select<Record<string, unknown>>("email_deliveries");
  return all.flatMap(found =>
    Object.values(found).map(value =>
      typeof value === "string" ? value : JSON.stringify(value ?? null)
    )
  );
}

/** A delivery service recording with `secrets`, current first. */
function deliveriesWith(
  t: TestNextly,
  secrets?: readonly string[]
): EmailDeliveryService {
  return new EmailDeliveryService(
    t.adapter as never,
    quiet,
    undefined,
    undefined,
    secrets ? () => secrets : undefined
  );
}

/** A record written erased for a deleted person: no digest, their id gone. */
function expectErased(found: DeliveryRow): void {
  expect(found.recipientHash).toBe(ERASED_RECIPIENT_HASH);
  expect(found.principalKind).toBe("staff");
  expect(found.principalId).toMatch(DIGEST);
}

describe.each(getConfiguredTestDialects())(
  "deleting a staff user erases their email records by person (%s)",
  dialect => {
    it("erases every record naming them, under an old address and the current one", async () => {
      const t = await boot(dialect);
      const id = await staffUser(t, "first@example.com");
      const atX = await added(t, () =>
        email(t, "first@example.com", staffPerson(id))
      );
      await moveTo(t, id, "second@example.com");
      const atY = await added(t, () =>
        email(t, "second@example.com", staffPerson(id))
      );

      await remove(t, id);

      for (const written of [...atX, ...atY]) {
        expectErased(await row(t, written.id));
      }
      expect(await everyStoredValue(t)).not.toContain(id);
      // The digest is the one the deleted-people list keeps.
      const [kept] = await t.adapter.select<{ digest: string }>(
        "nextly_deleted_principals"
      );
      expect((await row(t, atX[0].id)).principalId).toBe(kept.digest);
    }, 120_000);

    it("erases by address only the records that name nobody", async () => {
      const t = await boot(dialect);
      const shared = "shared@example.com";
      const id = await staffUser(t, shared);
      const member = await ctx!.principals!.byId("member", "mem_shared");
      if (!member) throw new Error("no member");
      // Written before sends named their person.
      const unnamed = await added(t, () => email(t, shared));
      // A plugin-defined person who reads mail at the same address.
      const theirs = await added(t, () => email(t, shared, member));

      await remove(t, id);

      expect((await row(t, unnamed[0].id)).recipientHash).toBe(
        ERASED_RECIPIENT_HASH
      );
      expect(await row(t, theirs[0].id)).toMatchObject({
        recipientHash: recipientDigest(shared),
        principalKind: "members:member",
        principalId: "mem_shared",
      });
    }, 120_000);

    it("still deletes on a database whose delivery log predates naming people", async () => {
      // An install that has not run `nextly migrate` since the person columns
      // and the deleted-people list arrived: the deletion erases by address,
      // as it did then, rather than failing on columns that are not there.
      const t = await boot(dialect);
      const id = await staffUser(t, "legacy@example.com");
      const exec = (statement: string) => t.adapter.executeQuery(statement);
      await exec(
        dialect === "mysql"
          ? "DROP INDEX email_deliveries_principal_idx ON email_deliveries"
          : "DROP INDEX email_deliveries_principal_idx"
      );
      await exec("ALTER TABLE email_deliveries DROP COLUMN principal_id");
      await exec("ALTER TABLE email_deliveries DROP COLUMN principal_kind");
      await exec("DROP TABLE nextly_deleted_principals");

      await remove(t, id);

      const [left] = await t.adapter.select<{ id: string }>("users", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      expect(left).toBeUndefined();
    }, 120_000);

    it("leaves the records of someone who later took an address they used", async () => {
      const t = await boot(dialect);
      const reused = "reused@example.com";
      const first = await staffUser(t, reused);
      await email(t, reused, staffPerson(first));
      await moveTo(t, first, "moved-on@example.com");
      const next = await staffUser(t, reused);
      const theirs = await added(t, () => email(t, reused, staffPerson(next)));

      await remove(t, first);

      expect(await row(t, theirs[0].id)).toMatchObject({
        recipientHash: recipientDigest(reused),
        principalKind: "staff",
        principalId: next,
      });
    }, 120_000);

    it("keeps only a keyed digest of the deleted user, with no expiry", async () => {
      const t = await boot(dialect);
      const id = await staffUser(t, "kept@example.com");

      await remove(t, id);

      const kept = await t.adapter.select<Record<string, unknown>>(
        "nextly_deleted_principals"
      );
      expect(kept).toHaveLength(1);
      expect(Object.keys(kept[0]).sort()).toEqual(["deletedAt", "digest"]);
      expect(kept[0].digest).toMatch(DIGEST);
      expect(JSON.stringify(kept)).not.toContain(id);
      expect(JSON.stringify(kept)).not.toContain("kept@example.com");
    }, 120_000);

    it("writes a record erased long after the deletion, the delivery log pruned in between", async () => {
      const t = await boot(dialect);
      const id = await staffUser(t, "retained@example.com");
      await email(t, "retained@example.com", staffPerson(id));
      await remove(t, id);

      // A year on, with a 90-day window: every delivery row is pruned, and the
      // deleted-people list, which has no expiry, is not.
      const yearOn = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await pruneEmailData(
        { adapter: t.adapter, now: () => yearOn },
        {
          maxAgeMs: 90 * 24 * 60 * 60 * 1000,
          intervalMs: 60_000,
          maxBatchesPerRun: 10,
        }
      );
      expect(await rows(t)).toEqual([]);

      const late = await added(t, () =>
        deliveriesWith(t).record({
          to: "retained@example.com",
          providerType: "capturing-mailer",
          status: "sent",
          person: staffPerson(id),
        })
      );
      expect(late).toHaveLength(1);
      expectErased(late[0]);
    }, 120_000);

    it("writes a record erased after the secret is rotated and the old one removed", async () => {
      const t = await boot(dialect);
      const id = await staffUser(t, "rotated@example.com");
      await remove(t, id);
      const current = process.env.NEXTLY_SECRET as string;
      const next = "staff-rotation-secret-next-0123456789abcdef";

      // Rotated: the key is sealed again under the new secret, after which the
      // old one is no longer configured.
      await resealPrincipalDigestKeyAtBoot(t.adapter as never, [next, current]);
      const late = await added(t, () =>
        deliveriesWith(t, [next]).record({
          to: "rotated@example.com",
          providerType: "capturing-mailer",
          status: "sent",
          person: staffPerson(id),
        })
      );
      expect(late).toHaveLength(1);
      expectErased(late[0]);
    }, 120_000);

    it("erases a record whose write races the deletion's commit", async () => {
      // The write reads that the user is not deleted and is held there; the
      // deletion then starts. The record is written only after the deletion
      // has had every chance to record the user and scan their rows, and must
      // still end up erased.
      const t = await boot(dialect);
      const id = await staffUser(t, "race@example.com");
      let reached!: () => void;
      const checked = new Promise<void>(resolve => (reached = resolve));
      let release!: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      const service = new EmailDeliveryService(
        pausingAdapter(t, deliveriesTableFor(dialect), reached, gate) as never,
        quiet
      );

      const writing = service.record({
        to: "race@example.com",
        providerType: "capturing-mailer",
        status: "sent",
        person: staffPerson(id),
      });
      await checked;
      const deleting = await deletionAtLock(dialect, () => remove(t, id));
      release();
      await writing;
      await deleting.done;

      const all = await rows(t);
      expect(all).toHaveLength(1);
      expectErased(all[0]);
    }, 120_000);

    it.runIf(dialect !== "sqlite")(
      "completes beside an audit write naming the user and a person, holding the lock",
      async () => {
        // The write holds the deleted-people lock shared, and its row names
        // the user as its actor, which needs the user's row. The deletion
        // waits for the lock before it takes that row, so neither waits on
        // the other: the write finishes, then the deletion. Taken in the other
        // order, PostgreSQL and MySQL would end one of them as a deadlock.
        const t = await boot(dialect);
        const id = await staffUser(t, "audited@example.com");
        const member = await ctx!.principals!.byId("member", "mem_audited");
        if (!member) throw new Error("no member");
        let held!: () => void;
        const holding = new Promise<void>(resolve => (held = resolve));
        let release!: () => void;
        const released = new Promise<void>(resolve => (release = resolve));
        digestLock.afterShared = async () => {
          held();
          await released;
        };

        const auditing = buildAuditLogWriter(
          (name: string) =>
            t.getService(name as Parameters<TestNextly["getService"]>[0]),
          {}
        ).write({
          kind: "members.changed",
          actorUserId: id,
          targetPrincipal: member,
        } as unknown as AuditEvent);
        await holding;
        const deleting = await deletionAtLock(dialect, () => remove(t, id));
        release();

        await expect(auditing).resolves.not.toThrow();
        await expect(deleting.done).resolves.not.toThrow();
      },
      120_000
    );

    it("writes erased the record of a send held across the deletion, a retry and a provider's report", async () => {
      const t = await boot(dialect);
      const id = await staffUser(t, "inflight@example.com");
      // The provider accepts the message, and the user is deleted before the
      // send records it: the send was in flight when the deletion committed.
      duringSend = async () => {
        duringSend = undefined;
        await remove(t, id);
      };
      const inFlight = await added(t, () =>
        email(t, "inflight@example.com", staffPerson(id))
      );
      // A failed attempt retried, and the provider reporting on the message
      // later: both written after the deletion, naming the user.
      const later = await added(t, async () => {
        const deliveries = deliveriesWith(t);
        await deliveries.record({
          to: "inflight@example.com",
          providerType: "capturing-mailer",
          status: "failed",
          person: staffPerson(id),
        });
        await deliveries.record({
          to: "inflight@example.com",
          providerType: "capturing-mailer",
          status: "sent",
          person: staffPerson(id),
        });
      });

      expect(inFlight).toHaveLength(1);
      expect(later).toHaveLength(2);
      for (const written of [...inFlight, ...later]) expectErased(written);
      expect(await everyStoredValue(t)).not.toContain(id);
    }, 120_000);
  }
);

/**
 * Start `deletion` and return it once it is waiting for the deleted-people
 * lock. PostgreSQL and MySQL reach the lock request and wait there, which the
 * hook shows; SQLite queues the whole deletion behind the transaction that
 * holds the lock, so it cannot reach the request until that one ends, and a
 * pause stands in.
 */
async function deletionAtLock(
  dialect: TestDialect,
  deletion: () => Promise<unknown>
): Promise<{ done: Promise<unknown> }> {
  let reached!: () => void;
  const atLock = new Promise<void>(resolve => (reached = resolve));
  digestLock.beforeExclusive = reached;
  const done = deletion();
  done.catch(() => undefined);
  if (dialect === "sqlite") {
    await new Promise(resolve => setTimeout(resolve, 750));
  } else {
    let arrived = false;
    await Promise.race([
      atLock.then(() => (arrived = true)),
      new Promise(resolve => setTimeout(resolve, 20_000)),
    ]);
    expect(arrived).toBe(true);
    // Long enough for the lock request to reach the database and wait.
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return { done };
}

/**
 * The booted adapter, with every insert into `table` held at `gate` after
 * signalling `reached`: by then the writer holds its lock and has read
 * whether the person was deleted, and has not yet written its row.
 */
function pausingAdapter(
  t: TestNextly,
  table: unknown,
  reached: () => void,
  gate: Promise<void>
): unknown {
  const real = t.adapter as unknown as {
    dialect: string;
    getCapabilities(): unknown;
    transaction(work: unknown): Promise<unknown>;
    transactionOpenInFlow(): boolean;
    getDrizzle(relations?: unknown): object;
  };
  return {
    dialect: real.dialect,
    getCapabilities: () => real.getCapabilities(),
    transaction: (work: unknown) => real.transaction(work),
    transactionOpenInFlow: () => real.transactionOpenInFlow(),
    getDrizzle: (relations?: unknown) =>
      pausing(real.getDrizzle(relations), table, reached, gate),
  };
}

type Method = (...args: unknown[]) => unknown;

function pausing(
  db: object,
  table: unknown,
  reached: () => void,
  gate: Promise<void>
): object {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "insert") {
        return (into: unknown) => {
          const builder = (value as Method).call(target, into) as {
            values(values: unknown): Promise<unknown>;
          };
          if (into !== table) return builder;
          return {
            values: async (values: unknown) => {
              reached();
              await gate;
              return builder.values(values);
            },
          };
        };
      }
      if (prop === "transaction") {
        return (work: (tx: object) => Promise<unknown>) =>
          (value as Method).call(target, (tx: object) =>
            work(pausing(tx, table, reached, gate))
          );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

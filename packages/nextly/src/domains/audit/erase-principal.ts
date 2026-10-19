/**
 * Erasing a plugin-defined person from the audit trail when their plugin
 * reports them deleted, while keeping the rows.
 *
 * The model is a staff user's deletion (`erase-actor-personal-data`): the
 * address and the client on every row the person acted on, and the plugin
 * metadata on every plugin row naming them as actor or subject, are cleared,
 * and the row stays as the record of what happened. Two things differ. A
 * plugin's id for a person may itself be an address, so the id on those rows
 * is replaced by the keyed digest of kind and id; and the person is recorded
 * as deleted, by that digest, so every audit row written for them afterwards
 * is written already erased (see `principal-digest`).
 *
 * All of it happens in one transaction: the plugin's own when it passes one,
 * so the deletion and the erasure commit together, and otherwise one of its
 * own. Never as lone statements: on SQLite a lone statement made while another
 * request's transaction is open runs inside it, and that request's rollback
 * would undo the erasure. A report made inside an open transaction without
 * passing it is refused rather than left to join it or to race it.
 *
 * @module domains/audit/erase-principal
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  eq,
  isNotNull,
  isNull,
  like,
  or,
  type Column,
  type Table,
} from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import { linkedTransaction } from "../../plugins/database/plugin-transaction-link";
import { staffPerson } from "../../plugins/principals/ref";
import {
  CONTENT_EVENTS_TABLE,
  contentEventsTables,
} from "../../schemas/content-events";
import {
  assertNoOpenTransaction,
  type OpenTransactionProbe,
} from "../../shared/lib/open-transaction";
import type { RowLockServer } from "../../shared/lib/row-lock";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import { deliveriesTableFor } from "../email/deliveries-table";
import {
  erasePrincipalDeliveries,
  type PersonDeliveriesTable,
} from "../email/erase-recipient";

import { adapterDialect, rowLockServer } from "./audit-log-writer";
import {
  markHoldsDeletionLock,
  readPrincipalDigests,
  resealPrincipalDigestKey,
  type DigestSubject,
  type PrincipalDigestDb,
  type PrincipalDigestTables,
} from "./principal-digest";

/** What a refusal or a log names the report as. */
const OPERATION = "ctx.principals.reportDeleted";

/** The audit-log columns a person's erasure reads and writes. */
export interface PrincipalAuditLog extends Table {
  kind: Column;
  metadata: Column;
  ipAddress: Column;
  userAgent: Column;
  identityErasedAt: Column;
  actorPrincipalKind: Column;
  actorPrincipalId: Column;
  targetPrincipalKind: Column;
  targetPrincipalId: Column;
}

/** The Drizzle surface the report needs: the digest's reads and the updates. */
export interface PrincipalErasureDb extends PrincipalDigestDb {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/** The adapter surface a report runs through. */
export interface PrincipalErasureAdapter extends OpenTransactionProbe {
  transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
  /** Whether a table exists, for one a database may not have yet. */
  tableExists?(table: string): Promise<boolean>;
}

/**
 * Report a person deleted: record their digest and erase them from the audit
 * trail, in `tx` when one is passed and in a transaction of the report's own
 * otherwise.
 *
 * @param subject - The person, by full kind and id; checked by the caller.
 * @param options.tx - The handle a plugin's `ctx.db.transaction` callback
 *   received, to commit the report with the plugin's own work.
 * @param options.adapter - The database adapter.
 * @param options.secrets - The install's secrets, current first.
 * @throws {NextlyError} `VALIDATION_ERROR` for a `tx` that is not such a
 *   handle; `INTERNAL_ERROR` for a report made inside an open transaction
 *   without passing it, or when the digest key cannot be read.
 */
export async function reportPrincipalDeleted(
  subject: DigestSubject,
  options: {
    tx?: unknown;
    adapter: PrincipalErasureAdapter;
    secrets: readonly string[];
  }
): Promise<void> {
  const { adapter, secrets } = options;
  const dialect = adapterDialect(adapter);
  if (!dialect) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage: `${OPERATION} could not tell which database the adapter talks to.`,
      logContext: { operation: OPERATION },
    });
  }
  const server = rowLockServer(adapter, dialect);
  // The record of content events is erased only where it exists: a database
  // that has not run `nextly migrate` since it arrived lacks it, and an update
  // against a missing table would fail the whole report.
  const contentEventsExist =
    adapter.tableExists === undefined
      ? true
      : await adapter.tableExists(CONTENT_EVENTS_TABLE);
  const tables = principalErasureTables(dialect, contentEventsExist);
  const erase = (tx: TransactionContext) =>
    erasePrincipal(
      tx.getDrizzle<PrincipalErasureDb>(),
      server,
      tables,
      subject,
      secrets
    );

  if (options.tx !== undefined) {
    // Refused before anything is marked: a handle that is not a plugin
    // transaction's names no transaction to hold the lock.
    const link = linkedTransaction(options.tx, OPERATION);
    // Marked before the lock is asked for, so an audit write the plugin
    // started alongside the report joins the transaction too.
    markHoldsDeletionLock(options.tx as object);
    await link.run(erase);
    return;
  }
  // A precondition: refused before the report's own transaction is opened.
  assertNoOpenTransaction(adapter, OPERATION);
  await runAdapterTransaction(adapter.transaction.bind(adapter), erase);
}

/**
 * Inside a staff user's deletion transaction: put the user on the
 * deleted-people list, as a deleted plugin-defined person is put on it, and
 * erase every delivery record that names them, whatever address it went to.
 *
 * Recorded under the lock every write naming a person shares, so a delivery
 * record being written for the user is either finished first and erased here,
 * or waits for the deletion to commit and is written erased, its id replaced
 * by the digest. The list keeps only the keyed digest of kind and id, with no
 * expiry, under the key that survives a rotation of the install's secret.
 *
 * Their audit rows are not touched here: a staff user's deletion erases those
 * through the audit trail's own staff erasure.
 */
export async function recordStaffUserDeleted(
  db: PrincipalErasureDb,
  adapter: unknown,
  userId: string,
  secrets: readonly string[]
): Promise<void> {
  const dialect = adapterDialect(adapter);
  if (!dialect) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage:
        "A staff user's deletion could not tell which database the adapter talks to.",
      logContext: { operation: "deleteUser" },
    });
  }
  const tables = principalErasureTables(dialect, false);
  const subject = staffPerson(userId);
  const digests = await readPrincipalDigests(
    db,
    rowLockServer(adapter, dialect),
    tables,
    "exclusive",
    secrets
  );
  const digest = digests.digest(subject);
  if (!(await digests.isDeleted(subject))) {
    await db.insert(tables.deleted).values({ digest, deletedAt: new Date() });
  }
  await erasePrincipalDeliveries(db, tables.deliveries, subject, digest);
}

/**
 * At boot, seal the stored digest key again under the current secret when it
 * is sealed under a retired one (see `resealPrincipalDigestKey`), in a
 * transaction of its own.
 *
 * A key no configured secret opens is logged, never thrown: the app starts,
 * and only audit writes naming a person and deletion reports fail, each one
 * logged, until the secret it was sealed under is configured again.
 */
export async function resealPrincipalDigestKeyAtBoot(
  adapter: PrincipalErasureAdapter,
  secrets: readonly string[]
): Promise<void> {
  const dialect = adapterDialect(adapter);
  if (!dialect) return;
  const server = rowLockServer(adapter, dialect);
  const { meta } = principalErasureTables(dialect, false);
  try {
    await runAdapterTransaction(adapter.transaction.bind(adapter), tx =>
      resealPrincipalDigestKey(
        tx.getDrizzle<PrincipalErasureDb>(),
        server,
        meta,
        secrets
      )
    );
  } catch (error) {
    // The reason only: nothing about the key or its envelope is logged.
    getNextlyLogger().error({
      kind: "principal-digest-key-unreadable",
      message:
        "The key that names deleted plugin-defined people cannot be read with the configured secrets. Configure the secret it was last sealed under in NEXTLY_SECRET_PREVIOUS.",
      reason: NextlyError.is(error)
        ? (error.logContext?.reason ?? error.code)
        : "unexpected",
    });
  }
}

/** The tables a person's erasure touches, on this dialect. */
function principalErasureTables(
  dialect: SupportedDialect,
  contentEventsExist: boolean
): ErasureTables {
  const schema = getDialectTables(dialect) as unknown as {
    auditLog: PrincipalAuditLog;
    nextlyMeta: PrincipalDigestTables["meta"];
    nextlyDeletedPrincipals: PrincipalDigestTables["deleted"];
  };
  return {
    auditLog: schema.auditLog,
    deliveries: deliveriesTableFor(dialect),
    meta: schema.nextlyMeta,
    deleted: schema.nextlyDeletedPrincipals,
    ...(contentEventsExist
      ? { contentEvents: contentEventsTables(dialect).nextlyContentEvents }
      : {}),
  };
}

/** Every table a person's deletion report reads or erases. */
type ErasureTables = PrincipalDigestTables & {
  auditLog: PrincipalAuditLog;
  deliveries: PersonDeliveriesTable;
  contentEvents?: PrincipalContentEvents;
};

/** The content-event columns a person's erasure reads and writes. */
interface PrincipalContentEvents extends Table {
  actorKind: Column;
  actorPrincipalKind: Column;
  actorId: Column;
  actorName: Column;
}

/**
 * Inside the report's transaction: take the deleted-people lock, record the
 * person, then erase their rows. Recorded before the scan, and under the lock
 * every audit writer naming a person shares, so a writer is either finished
 * before the scan starts and its row is erased by it, or waits for this
 * commit and writes its row already erased.
 */
async function erasePrincipal(
  db: PrincipalErasureDb,
  server: RowLockServer,
  tables: ErasureTables,
  subject: DigestSubject,
  secrets: readonly string[]
): Promise<void> {
  const digests = await readPrincipalDigests(
    db,
    server,
    tables,
    "exclusive",
    secrets
  );
  const digest = digests.digest(subject);
  const erasedAt = new Date();
  // A second report of the same person finds the record and leaves it, with
  // the time it was first recorded.
  if (!(await digests.isDeleted(subject))) {
    await db.insert(tables.deleted).values({ digest, deletedAt: erasedAt });
  }
  await erasePrincipalAuditRows(db, tables.auditLog, subject, digest, erasedAt);
  // The same transaction erases the email they were sent, so the report
  // leaves no record naming them either way or neither.
  await erasePrincipalDeliveries(db, tables.deliveries, subject, digest);
  if (tables.contentEvents) {
    await erasePrincipalContentEvents(
      db,
      tables.contentEvents,
      subject,
      digest
    );
  }
}

/**
 * Erase a person's identifiers from the audit trail and name them by
 * `digest` on every row that named them.
 *
 * Keyed on the person's own columns, never on the staff user columns: a staff
 * user whose id equals the person's keeps every row of theirs. The address and
 * the client are erased on the rows the person ACTED on only; on a row about
 * them, those belong to whoever acted, as a staff user's deletion leaves them.
 */
export async function erasePrincipalAuditRows(
  db: PrincipalErasureDb,
  auditLog: PrincipalAuditLog,
  subject: DigestSubject,
  digest: string,
  erasedAt: Date
): Promise<void> {
  const asActor = and(
    eq(auditLog.actorPrincipalKind, subject.kind),
    eq(auditLog.actorPrincipalId, subject.id)
  );
  const asTarget = and(
    eq(auditLog.targetPrincipalKind, subject.kind),
    eq(auditLog.targetPrincipalId, subject.id)
  );

  await db
    .update(auditLog)
    .set({ ipAddress: null, userAgent: null, identityErasedAt: erasedAt })
    .where(
      and(
        asActor,
        // Rows already erased keep the stamp of the erasure that reached them.
        or(
          isNotNull(auditLog.ipAddress),
          isNotNull(auditLog.userAgent),
          isNull(auditLog.identityErasedAt)
        )
      )
    );

  // A plugin's metadata may name either party; core's own rows carry core's
  // fixed projection, which names nobody. A plugin's kind always carries its
  // `<slug>.` prefix, and no core kind contains a dot.
  await db
    .update(auditLog)
    .set({ metadata: null })
    .where(
      and(
        like(auditLog.kind, "%.%"),
        or(asActor, asTarget),
        isNotNull(auditLog.metadata)
      )
    );

  // Last, as the two above find the rows by the id these replace.
  await db.update(auditLog).set({ actorPrincipalId: digest }).where(asActor);
  await db.update(auditLog).set({ targetPrincipalId: digest }).where(asTarget);
}

/**
 * Erase a person from the record of content events: the name they had on
 * each event they performed goes, and their id is replaced by the keyed
 * digest the audit trail names them by, so the events still tell one actor
 * from another and name nobody. A plugin's id for a person may itself be an
 * address, which is why the id goes too.
 */
async function erasePrincipalContentEvents(
  db: PrincipalErasureDb,
  contentEvents: PrincipalContentEvents,
  subject: DigestSubject,
  digest: string
): Promise<void> {
  await db
    .update(contentEvents)
    .set({ actorName: null, actorId: digest })
    .where(
      and(
        eq(contentEvents.actorKind, "principal"),
        eq(contentEvents.actorPrincipalKind, subject.kind),
        eq(contentEvents.actorId, subject.id)
      )
    );
}

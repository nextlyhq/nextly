/**
 * The keyed digest that names a plugin-defined person once their plugin has
 * reported them deleted.
 *
 * A plugin's id for a person may be an address, so a deleted person is kept
 * by an HMAC of their kind and id, never by the id itself: in the
 * deleted-people table, and in place of the id on the audit rows that name
 * them. The digest has to keep matching for as long as the record is kept,
 * which is forever, while the install's secret rotates. So the digest is not
 * keyed by the secret. Core makes one random key, once, and keeps it in
 * `nextly_meta` sealed under the secret; a rotation re-seals the same key
 * under the new secret the first time it is read, and digests made before the
 * rotation still match after the earlier secret is gone.
 *
 * The key row is also the lock that orders a deletion report against the
 * audit writes naming a person. Every such write reads the key under a shared
 * lock, held until it commits; a report reads it under an exclusive one
 * before it records the person and erases their rows. Either the write takes
 * its lock first, and the report waits until the row exists and its scan
 * finds it, or the report does, and the write waits until the record is
 * committed and then finds the person deleted. SQLite has no row locks and
 * needs none: its writers are serialised by `BEGIN IMMEDIATE`.
 *
 * Neither the key nor anything derived from it but the digest leaves this
 * module: never in a log, an error or a return value.
 *
 * @module domains/audit/principal-digest
 */
import { createHmac, randomBytes } from "node:crypto";

import { eq, type Column, type Table } from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";
import {
  readUnderRowLock,
  type LockableRead,
  type RowLockServer,
} from "../../shared/lib/row-lock";
import { openSetting, sealSetting } from "../plugins/settings-crypto";

/** The `nextly_meta` key the sealed digest key is kept under. */
export const PRINCIPAL_DIGEST_KEY_META_KEY = "audit.principalDigestKey";

/**
 * Who the sealed key belongs to, bound into the envelope's associated data
 * with its path, so an envelope copied from a plugin's settings fails to open
 * here rather than being read as this key. A plugin's name cannot contain the
 * space this one does.
 */
const SEAL_OWNER = "nextly core";
const SEAL_PATH = [PRINCIPAL_DIGEST_KEY_META_KEY] as const;

/** Bytes of key material: the HMAC-SHA256 block's worth of entropy. */
const KEY_BYTES = 32;

/**
 * How the key is stored, as one string in the `value` column.
 *
 * Sealed: `sealed:` and a settings-crypto envelope. Unsealed: `unsealed:` and
 * the key in base64url, written only by an install with no `NEXTLY_SECRET`,
 * which production refuses to start without; the first write made once a
 * secret is configured seals it.
 */
const SEALED = "sealed:";
const UNSEALED = "unsealed:";

/** A person, by the kind their plugin registered and their id in it. */
export interface DigestSubject {
  kind: string;
  id: string;
}

/** The tables the key and the deleted-people record live in. */
export interface PrincipalDigestTables {
  meta: Table & { key: Column; value: Column; updatedAt: Column };
  deleted: Table & { digest: Column; deletedAt: Column };
}

/**
 * The Drizzle surface this needs. Structural, as the concrete database types
 * are dialect-specific while the fluent API is the same on all three.
 */
export interface PrincipalDigestDb {
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): LockableRead<Record<string, unknown>[]>;
      };
    };
  };
  insert(table: unknown): {
    values(data: unknown): InsertIfAbsent;
    ignore?(): { values(data: unknown): Promise<unknown> };
  };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/** An insert that can be told to leave an existing row alone. */
type InsertIfAbsent = Promise<unknown> & {
  onConflictDoNothing?(): Promise<unknown>;
};

/**
 * Plugin transactions holding the exclusive lock, by the handle the plugin's
 * callback received. An audit write made in such a transaction's flow joins
 * it: a write in a transaction of its own would wait for the lock the plugin
 * holds until it commits, while the plugin waits for the write. Weak, so a
 * finished transaction's handle is dropped with it.
 */
const holdingDeletionLock = new WeakSet<object>();

/** Record that the plugin transaction behind `handle` takes the lock. */
export function markHoldsDeletionLock(handle: object): void {
  holdingDeletionLock.add(handle);
}

/** Whether the plugin transaction behind `handle` holds the lock. */
export function holdsDeletionLock(handle: object): boolean {
  return holdingDeletionLock.has(handle);
}

/** Which lock a caller holds the key row under until it commits. */
export type DigestKeyLock = "shared" | "exclusive";

/** What a caller can do with the key it read, for the rest of its transaction. */
export interface PrincipalDigests {
  /** The keyed digest of a person: hex HMAC-SHA256 of kind and id. */
  digest(subject: DigestSubject): string;
  /** Whether the person was reported deleted, read under the lock held. */
  isDeleted(subject: DigestSubject): Promise<boolean>;
}

/**
 * Read the digest key under `lock`, making or re-sealing it first when it is
 * missing or sealed under a retired secret, inside the caller's transaction.
 *
 * Making and re-sealing happen before the lock is taken, as writes of their
 * own: taking a shared lock and then writing the row would upgrade it, and two
 * writers doing that at once wait on each other. A writer that loses the race
 * to make the key finds the winner's key under its lock, since the insert
 * leaves an existing row alone. A re-seal that races another writes the same
 * key under the same secret, so either one standing is right.
 *
 * @param secrets - The install's secrets, current first (`NEXTLY_SECRET`, then
 *   `NEXTLY_SECRET_PREVIOUS`). Empty only outside production.
 * @throws {NextlyError} `INTERNAL_ERROR` when the stored key cannot be opened
 *   with any configured secret: a rotation that dropped the secret the key was
 *   last sealed under before it was read again. The key is not remade, since a
 *   new one would match none of the digests already kept.
 */
export async function readPrincipalDigests(
  db: PrincipalDigestDb,
  server: RowLockServer,
  tables: PrincipalDigestTables,
  lock: DigestKeyLock,
  secrets: readonly string[]
): Promise<PrincipalDigests> {
  await prepareKey(db, server, tables, secrets);
  const stored = await readStoredKey(db, tables.meta, server, lock);
  if (stored === undefined) throw keyUnreadable("missing");
  const key = openKey(stored, secrets);
  const digest = (subject: DigestSubject) => keyedDigest(key, subject);
  return {
    digest,
    async isDeleted(subject) {
      // A locking read on MySQL: under REPEATABLE READ a plain read answers
      // from the snapshot the transaction's first read took, which can be
      // older than the report this lock just waited for.
      const query = db
        .select({ digest: tables.deleted.digest })
        .from(tables.deleted)
        .where(eq(tables.deleted.digest, digest(subject)))
        .limit(1);
      const rows = await readUnderRowLock(query, server, "existence-check");
      return rows.length > 0;
    },
  };
}

/** How the stored key stood when {@link resealPrincipalDigestKey} looked. */
export type ResealOutcome = "absent" | "current" | "resealed";

/**
 * Seal the stored key again under the current secret, when it is sealed under
 * a retired one or not sealed at all, in the caller's transaction. Never makes
 * a key: an install that has never named a person has none to seal.
 *
 * Called at boot, as stored plugin secrets are sealed again then, so a key
 * last sealed under a secret since rotated is moved to the current one at the
 * first start that has both, and the retired secret can go once the app has
 * started with it. A row naming a person would also re-seal it, but only once
 * one is written, and an install that writes none between two rotations
 * would otherwise lose the key.
 *
 * @throws {NextlyError} `INTERNAL_ERROR` when the stored key cannot be opened
 *   with any configured secret.
 */
export async function resealPrincipalDigestKey(
  db: PrincipalDigestDb,
  server: RowLockServer,
  meta: PrincipalDigestTables["meta"],
  secrets: readonly string[]
): Promise<ResealOutcome> {
  const stored = await readStoredKey(db, meta, server, "exclusive");
  if (stored === undefined) return "absent";
  if (!needsReseal(stored, secrets)) {
    // Opened, so a key no configured secret can read is reported now rather
    // than at the first write naming a person.
    openKey(stored, secrets);
    return "current";
  }
  await db
    .update(meta)
    .set({
      value: storedForm(openKey(stored, secrets), secrets),
      updatedAt: new Date(),
    })
    .where(eq(meta.key, PRINCIPAL_DIGEST_KEY_META_KEY));
  return "resealed";
}

/** HMAC-SHA256 of kind and id, separated by a NUL neither can contain. */
function keyedDigest(key: Buffer, subject: DigestSubject): string {
  return createHmac("sha256", key)
    .update(`${subject.kind}\u0000${subject.id}`, "utf8")
    .digest("hex");
}

/** Make the key when there is none, and re-seal it when it is stale. */
async function prepareKey(
  db: PrincipalDigestDb,
  server: RowLockServer,
  tables: PrincipalDigestTables,
  secrets: readonly string[]
): Promise<void> {
  const stored = await readStoredKey(db, tables.meta, server, null);
  if (stored === undefined) {
    await insertIfAbsent(db, server, tables.meta, {
      key: PRINCIPAL_DIGEST_KEY_META_KEY,
      value: storedForm(randomBytes(KEY_BYTES), secrets),
      updatedAt: new Date(),
    });
    return;
  }
  if (!needsReseal(stored, secrets)) return;
  await db
    .update(tables.meta)
    .set({
      value: storedForm(openKey(stored, secrets), secrets),
      updatedAt: new Date(),
    })
    .where(eq(tables.meta.key, PRINCIPAL_DIGEST_KEY_META_KEY));
}

/** The stored key, or undefined when none has been made. */
async function readStoredKey(
  db: PrincipalDigestDb,
  meta: PrincipalDigestTables["meta"],
  server: RowLockServer,
  lock: DigestKeyLock | null
): Promise<string | undefined> {
  const query = db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, PRINCIPAL_DIGEST_KEY_META_KEY))
    .limit(1);
  const [row] = await (lock === null
    ? query
    : readUnderRowLock(
        query,
        server,
        lock === "exclusive" ? "exclusive" : "existence-check"
      ));
  if (row === undefined) return undefined;
  // A string on every dialect: the JSON columns hand back the JSON string the
  // key was stored as, and SQLite's text column the text itself.
  return typeof row.value === "string" ? row.value : "";
}

/** Insert `row` unless its key exists, without failing when it does. */
async function insertIfAbsent(
  db: PrincipalDigestDb,
  server: RowLockServer,
  table: Table,
  row: Record<string, unknown>
): Promise<void> {
  if (server.dialect === "mysql") {
    const insert = db.insert(table);
    if (!insert.ignore) throw keyUnreadable("no insert-ignore on this driver");
    await insert.ignore().values(row);
    return;
  }
  const pending = db.insert(table).values(row);
  if (!pending.onConflictDoNothing) {
    throw keyUnreadable("no on-conflict insert on this driver");
  }
  await pending.onConflictDoNothing();
}

/** The key as stored: sealed under the current secret when there is one. */
function storedForm(key: Buffer, secrets: readonly string[]): string {
  const [current] = secrets;
  const encoded = key.toString("base64url");
  return current === undefined
    ? `${UNSEALED}${encoded}`
    : `${SEALED}${sealSetting(encoded, current, SEAL_OWNER, SEAL_PATH)}`;
}

/** Whether the stored key should be sealed again under the current secret. */
function needsReseal(stored: string, secrets: readonly string[]): boolean {
  if (stored.startsWith(UNSEALED)) return secrets.length > 0;
  if (!stored.startsWith(SEALED)) return false;
  const opened = openSetting(
    stored.slice(SEALED.length),
    secrets,
    SEAL_OWNER,
    SEAL_PATH
  );
  return opened.readable && opened.stale;
}

/** The key itself, or an error naming why it cannot be read. */
function openKey(stored: string, secrets: readonly string[]): Buffer {
  if (stored.startsWith(UNSEALED)) {
    return decodeKey(stored.slice(UNSEALED.length));
  }
  if (!stored.startsWith(SEALED)) throw keyUnreadable("malformed");
  const opened = openSetting(
    stored.slice(SEALED.length),
    secrets,
    SEAL_OWNER,
    SEAL_PATH
  );
  if (!opened.readable) throw keyUnreadable(opened.reason);
  return decodeKey(opened.plaintext);
}

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== KEY_BYTES) throw keyUnreadable("malformed");
  return key;
}

/**
 * The error for a key that cannot be used. Names why, never the key or the
 * envelope: both stay out of every log.
 */
function keyUnreadable(reason: string): NextlyError {
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage:
      "The key that names deleted plugin-defined people cannot be read. Configure the secret it was last sealed under in NEXTLY_SECRET_PREVIOUS.",
    logContext: { reason, metaKey: PRINCIPAL_DIGEST_KEY_META_KEY },
  });
}

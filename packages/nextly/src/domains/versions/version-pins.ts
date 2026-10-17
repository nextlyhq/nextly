/**
 * Version pins: versions a feature holds against retention.
 *
 * A feature holds named slots on a document, each pointing at one of its
 * versions. Retention never removes a version any slot points at, whatever the
 * limit, so a feature can keep the version an approval named, or the version
 * last brought into review, for as long as it needs it.
 *
 * Slots rather than pins on versions: a feature's need is "the version last
 * approved", one pointer that moves. Moving a slot releases the version it
 * pointed at in the same step, so a feature cannot leak pins by forgetting to
 * release the old one. A version stays while any slot of any feature points at
 * it, so one feature releasing never frees what another still holds.
 *
 * Holders are registered, as comparison baselines are: a feature registers its
 * name once, and registration hands it the one handle that pins under that
 * name. There is no lookup by name, so no other code can move or release the
 * slots a feature relies on, and a misspelt holder cannot quietly create pins
 * nobody releases.
 *
 * Every call takes the caller's transaction, so a feature pins in the same
 * transaction as the change it records. A pin takes the document's write lock,
 * the lock every save holds, so a pin and a save's retention pass cannot
 * interleave: the pin lands before the pass reads the pins, or waits for it.
 *
 * @module domains/versions/version-pins
 * @experimental
 */

import { createHash } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors";
import type { VersionScopeKind } from "../../schemas/versions/types";

import type { VersionsDbApi } from "./db-api";
import type { VersionRef } from "./versions-repository";

const PINS_TABLE = "nextly_version_pins";
const VERSIONS_TABLE = "nextly_versions";

/** A feature that may hold versions. */
export interface VersionPinHolderDefinition {
  /** Its name, kebab-case and unique: what its pins are recorded under. */
  name: string;
  /** How a reader would name it ("Workflows"). */
  label: string;
}

/** One slot on a document, and the version it points at. */
export interface VersionPin {
  holder: string;
  slot: string;
  versionNo: number;
}

/** What a registered holder can do with its own slots. */
export interface VersionPinHolder {
  /**
   * Point a slot at a version, creating the slot or moving it. Refuses a
   * version the document does not have.
   */
  pin(
    tx: TransactionContext,
    args: { ref: VersionRef; slot: string; versionNo: number }
  ): Promise<void>;
  /** Free one slot. Freeing a slot that does not exist is not an error. */
  release(
    tx: TransactionContext,
    args: { ref: VersionRef; slot: string }
  ): Promise<void>;
  /** Free every slot this holder has on the document. */
  releaseAll(tx: TransactionContext, ref: VersionRef): Promise<void>;
}

const HOLDER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_HOLDER_LENGTH = 64;
const MAX_SLOT_LENGTH = 191;

const holders = new Map<
  string,
  { definition: VersionPinHolderDefinition; handle: VersionPinHolder }
>();

/**
 * Register a feature that may hold versions, and get the handle it pins
 * through. Called once per feature as it loads; the feature keeps the handle.
 *
 * Refuses a name that is not kebab-case or is too long for its column, and a
 * name another feature registered: two features answering to one name would
 * release each other's pins. The same registration again (same name and
 * label) returns the same handle, since a module reloaded in development runs
 * its registration again.
 *
 * @experimental
 */
export function registerVersionPinHolder(
  definition: VersionPinHolderDefinition
): VersionPinHolder {
  const { name } = definition;
  if (!HOLDER_NAME.test(name) || name.length > MAX_HOLDER_LENGTH) {
    throw NextlyError.invalidInput({
      message: `Version pin holder "${name}" must be kebab-case and at most ${MAX_HOLDER_LENGTH} characters, such as "workflows".`,
      logContext: { name },
    });
  }
  const existing = holders.get(name);
  if (existing?.definition.label === definition.label) return existing.handle;
  if (existing) {
    throw NextlyError.invalidInput({
      message: `A version pin holder is already registered as "${name}" (${existing.definition.label}); choose another name for ${definition.label}.`,
      logContext: { name },
    });
  }
  const handle = holderHandle(name);
  holders.set(name, { definition: { ...definition }, handle });
  return handle;
}

/** Every registered holder's name. */
export function versionPinHolderNames(): string[] {
  return [...holders.keys()];
}

/** Forget every registered holder. Test seam. */
export function resetVersionPinHolders(): void {
  holders.clear();
}

/**
 * The digest the one-slot rule is enforced on: one row per document, holder
 * and slot. A digest rather than a composite index, so the key stays inside
 * MySQL's index size limit whatever the slug and slot lengths.
 */
export function versionPinKey(
  ref: VersionRef,
  holder: string,
  slot: string
): string {
  const joined = [ref.scopeKind, ref.scopeSlug, ref.entryId, holder, slot]
    .map(encodeURIComponent)
    .join(":");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

function documentWhere(ref: VersionRef) {
  return [
    { column: "scopeKind", op: "=" as const, value: ref.scopeKind },
    { column: "scopeSlug", op: "=" as const, value: ref.scopeSlug },
    { column: "entryId", op: "=" as const, value: ref.entryId },
  ];
}

function assertSlot(slot: string): void {
  if (slot.length === 0 || slot.length > MAX_SLOT_LENGTH) {
    throw NextlyError.invalidInput({
      message: `A version pin slot must be between 1 and ${MAX_SLOT_LENGTH} characters.`,
      logContext: { slotLength: slot.length },
    });
  }
}

/**
 * Where each kind of entity is registered. A page has no registry row to lock
 * here, so its versions cannot be pinned yet: a pin on one is refused as a
 * document that does not exist.
 */
export const REGISTRY_TABLES: Partial<Record<VersionScopeKind, string>> = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
};

/**
 * The document's table, from a locking read of the entity's registry row on
 * the caller's transaction, so its row can be locked the way a save locks it.
 * Null when the collection or Single itself is gone.
 *
 * Locking the registry row is what orders a pin against the entity's deletion,
 * which sweeps the entity's pins and removes that row in one transaction: a
 * pin either commits before the sweep and is swept, or waits for it and finds
 * the entity gone.
 */
async function documentTableName(
  tx: TransactionContext,
  ref: VersionRef
): Promise<string | null> {
  const registry = REGISTRY_TABLES[ref.scopeKind];
  if (registry === undefined) return null;
  const entity = await tx.selectOne<{ tableName: string }>(registry, {
    columns: ["tableName"],
    where: {
      and: [{ column: "slug", op: "=" as const, value: ref.scopeSlug }],
    },
    forUpdate: true,
  });
  return entity ? entity.tableName : null;
}

/**
 * Take the document's write lock, the lock every save and delete of it
 * holds, and say whether the document still exists.
 *
 * One locking read rather than a lock and then a read: on MySQL a plain read
 * returns the transaction's snapshot, which can still hold a row a delete
 * committed while this waited for the lock; a locking read sees the latest
 * committed row on every dialect.
 */
async function lockDocument(
  tx: TransactionContext,
  ref: VersionRef
): Promise<boolean> {
  const tableName = await documentTableName(tx, ref);
  if (tableName === null) return false;
  const row = await tx.selectOne<{ id: string }>(tableName, {
    columns: ["id"],
    where: {
      and: [{ column: "id", op: "=" as const, value: ref.entryId }],
    },
    forUpdate: true,
  });
  return row !== null;
}

async function assertVersionExists(
  tx: TransactionContext,
  ref: VersionRef,
  versionNo: number
): Promise<void> {
  const rows = await tx.select<{ id: string }>(VERSIONS_TABLE, {
    columns: ["id"],
    where: {
      and: [
        ...documentWhere(ref),
        { column: "versionNo", op: "=" as const, value: versionNo },
        { column: "isAutosave", op: "=" as const, value: false },
      ],
    },
    limit: 1,
  });
  if (rows.length === 0) {
    throw NextlyError.notFound({
      message: `Version ${versionNo} of this document does not exist, so it cannot be pinned.`,
      logContext: { reason: "version-pin-target-missing", versionNo, ...ref },
    });
  }
}

function holderHandle(name: string): VersionPinHolder {
  return {
    async pin(tx, { ref, slot, versionNo }) {
      assertSlot(slot);
      if (!Number.isInteger(versionNo) || versionNo < 1) {
        throw NextlyError.invalidInput({
          message: "A version number must be a positive integer.",
          logContext: { versionNo },
        });
      }
      // The save path's lock: a save's retention pass and this pin serialize,
      // so the pass either sees this pin or runs before it exists. A delete
      // holds it too, so a document deleted while this waited is refused
      // here rather than left with a pin its delete already swept.
      if (!(await lockDocument(tx, ref))) {
        throw NextlyError.notFound({
          message:
            "This document does not exist, so its versions cannot be pinned.",
          logContext: { reason: "version-pin-document-missing", ...ref },
        });
      }
      await assertVersionExists(tx, ref, versionNo);

      const pinKey = versionPinKey(ref, name, slot);
      // A locking read, for the reason `pinnedVersionNos` gives: a slot
      // another pin committed while this one waited for the lock is updated,
      // not inserted a second time.
      const existing = await tx.select<{ id: string }>(PINS_TABLE, {
        columns: ["id"],
        where: { and: [{ column: "pinKey", op: "=" as const, value: pinKey }] },
        limit: 1,
        forUpdate: true,
      });
      const now = new Date();
      if (existing.length > 0) {
        await tx.update(
          PINS_TABLE,
          { versionNo, updatedAt: now },
          { and: [{ column: "pinKey", op: "=" as const, value: pinKey }] }
        );
        return;
      }
      await tx.insert(PINS_TABLE, {
        id: crypto.randomUUID(),
        scopeKind: ref.scopeKind,
        scopeSlug: ref.scopeSlug,
        entryId: ref.entryId,
        holder: name,
        slot,
        versionNo,
        pinKey,
        createdAt: now,
        updatedAt: now,
      });
    },
    async release(tx, { ref, slot }) {
      assertSlot(slot);
      // Under the document lock, so a release cannot land between a pin's
      // read of its slot and its write: the pin would report success over a
      // row this deleted.
      await lockDocument(tx, ref);
      await tx.delete(PINS_TABLE, {
        and: [
          {
            column: "pinKey",
            op: "=" as const,
            value: versionPinKey(ref, name, slot),
          },
        ],
      });
    },
    async releaseAll(tx, ref) {
      await lockDocument(tx, ref);
      await tx.delete(PINS_TABLE, {
        and: [
          ...documentWhere(ref),
          { column: "holder", op: "=" as const, value: name },
        ],
      });
    },
  };
}

/**
 * The version pin API.
 *
 * @experimental
 */
export const versionPins = {
  /** Every slot on a document, of every holder. */
  async list(db: VersionsDbApi, ref: VersionRef): Promise<VersionPin[]> {
    return db.select<VersionPin>(PINS_TABLE, {
      columns: ["holder", "slot", "versionNo"],
      where: { and: documentWhere(ref) },
    });
  },
};

/**
 * The version numbers any slot on the document points at, for retention, read
 * on the saving transaction. A locking read: a plain one on MySQL answers from
 * the snapshot the transaction's first read took, and would miss a pin
 * committed since, leaving its version to be pruned.
 */
export async function pinnedVersionNos(
  db: VersionsDbApi,
  ref: VersionRef
): Promise<number[]> {
  const rows = await db.select<{ versionNo: number }>(PINS_TABLE, {
    columns: ["versionNo"],
    where: { and: documentWhere(ref) },
    forUpdate: true,
  });
  return rows.map(row => row.versionNo);
}

/** Remove a document's pins with the document. */
export async function deletePinsForDocument(
  db: VersionsDbApi,
  ref: VersionRef
): Promise<void> {
  await db.delete(PINS_TABLE, { and: documentWhere(ref) });
}

/** Remove every pin of an entity, when the entity itself is deleted. */
export async function deletePinsForEntity(
  db: VersionsDbApi,
  scopeKind: VersionScopeKind,
  scopeSlug: string
): Promise<void> {
  await db.delete(PINS_TABLE, {
    and: [
      { column: "scopeKind", op: "=" as const, value: scopeKind },
      { column: "scopeSlug", op: "=" as const, value: scopeSlug },
    ],
  });
}

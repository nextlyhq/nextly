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
 * Core registers one holder: `shared-publish-base`, a slot per language, each
 * holding the version a pending change began from, so the comparison that
 * keeps a publish from reverting a newer shared value always has its copy
 * (`shared-publish-base`).
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
import { refuseHistoryWriteIfRemovedFromCode } from "../dynamic-collections/services/removed-from-code-writes";

import type { VersionsDbApi } from "./db-api";
import { lockDocument } from "./history-locks";
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

/** One of a holder's own slots: its holder is the handle that read it. */
export interface VersionPinSlot {
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

/**
 * The holder registration hands back: everything a holder does, and a read of
 * its own slots. Kept apart from {@link VersionPinHolder} so a type that
 * implements or stands in for a holder keeps compiling without the read.
 */
export interface RegisteredVersionPinHolder extends VersionPinHolder {
  /**
   * This holder's slots on the document: a plain read, taking the caller's
   * transaction or the adapter. The holder is a predicate of the query, so
   * what other holders pin on the same document is never read, however many
   * slots they hold.
   */
  list(db: VersionsDbApi, ref: VersionRef): Promise<VersionPinSlot[]>;
}

const HOLDER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// A plugin's slug, as `pluginAdminSlug` makes it: it may start with a digit.
const PLUGIN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_HOLDER_LENGTH = 64;
const MAX_SLOT_LENGTH = 191;

const holders = new Map<
  string,
  { definition: VersionPinHolderDefinition; handle: RegisteredVersionPinHolder }
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
): RegisteredVersionPinHolder {
  const { name } = definition;
  if (!HOLDER_NAME.test(name) || name.length > MAX_HOLDER_LENGTH) {
    throw NextlyError.invalidInput({
      message: `Version pin holder "${name}" must be kebab-case and at most ${MAX_HOLDER_LENGTH} characters, such as "workflows".`,
      logContext: { name },
    });
  }
  return register(name, definition.label);
}

/**
 * Register a holder in a plugin's namespace, recorded as `<namespace>.<name>`
 * (`acme-billing.approvals`), as a plugin's events are named. The dot appears
 * in neither a plugin's slug nor a kebab-case name, and core's own names
 * cannot contain one, so two plugins naming a holder alike hold apart, and no
 * plugin's holder is ever one of core's. Refuses a recorded name too long for
 * its column. Returns the handle and the name its pins are recorded under.
 */
export function registerNamespacedVersionPinHolder(
  namespace: string,
  definition: VersionPinHolderDefinition
): { handle: RegisteredVersionPinHolder; recorded: string } {
  const { name } = definition;
  if (!HOLDER_NAME.test(name)) {
    throw NextlyError.invalidInput({
      message: `Version pin holder "${name}" must be kebab-case, such as "approvals".`,
      logContext: { name, namespace },
    });
  }
  const recorded = `${namespace}.${name}`;
  if (!PLUGIN_SLUG.test(namespace) || recorded.length > MAX_HOLDER_LENGTH) {
    throw NextlyError.invalidInput({
      message: `Version pin holder "${name}" is too long for this plugin: with its name, "${recorded}" must be at most ${MAX_HOLDER_LENGTH} characters.`,
      logContext: { name, namespace },
    });
  }
  return { handle: register(recorded, definition.label), recorded };
}

/**
 * Record a holder under `name`, or return the handle it already has: the same
 * name and label again is the same feature reloading.
 */
function register(name: string, label: string): RegisteredVersionPinHolder {
  const existing = holders.get(name);
  if (existing?.definition.label === label) return existing.handle;
  if (existing) {
    throw NextlyError.invalidInput({
      message: `A version pin holder is already registered as "${name}" (${existing.definition.label}); choose another name for ${label}.`,
      logContext: { name },
    });
  }
  const handle = holderHandle(name);
  holders.set(name, { definition: { name, label }, handle });
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

function holderHandle(name: string): RegisteredVersionPinHolder {
  return {
    async pin(tx, { ref, slot, versionNo }) {
      assertSlot(slot);
      if (!Number.isInteger(versionNo) || versionNo < 1) {
        throw NextlyError.invalidInput({
          message: "A version number must be a positive integer.",
          logContext: { versionNo },
        });
      }
      // A pin is held on a document's version, so it is refused when the
      // document's collection or Single is removed from code, as freeing one
      // is below: after the checks of the input alone, which touch nothing,
      // and before the document is locked. Read on the caller's transaction.
      await refuseHistoryWriteIfRemovedFromCode(ref, {
        executor: tx.getDrizzle(),
      });
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
      await refuseHistoryWriteIfRemovedFromCode(ref, {
        executor: tx.getDrizzle(),
      });
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
      await refuseHistoryWriteIfRemovedFromCode(ref, {
        executor: tx.getDrizzle(),
      });
      await lockDocument(tx, ref);
      await tx.delete(PINS_TABLE, {
        and: [
          ...documentWhere(ref),
          { column: "holder", op: "=" as const, value: name },
        ],
      });
    },
    list(db, ref) {
      return db.select<VersionPinSlot>(PINS_TABLE, {
        columns: ["slot", "versionNo"],
        where: {
          and: [
            ...documentWhere(ref),
            { column: "holder", op: "=" as const, value: name },
          ],
        },
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

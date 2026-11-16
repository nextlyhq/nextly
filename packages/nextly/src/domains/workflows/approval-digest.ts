/**
 * The digest an approval keeps of the content it approved, so a later save can be told apart from
 * one that changed nothing the approval covers.
 *
 * @module domains/workflows/approval-digest
 */
import { createHash } from "node:crypto";

import { NextlyError } from "../../errors";
import {
  immutableSystemColumnNames,
  type SystemColumnEntity,
} from "../../lib/system-columns";
import { canonicalJson } from "../../shared/lib/canonical-json";
import { documentSystemKeys } from "../versions/snapshot-system-keys";

/**
 * sha256, in hex, of the canonical JSON of a recorded version's content: its snapshot without the
 * keys the framework manages (id, timestamps, status, the version and its changer), which move on
 * saves that change no content, and without `exemptFields`, the fields a workflow lets an edit
 * change while an approval stands (`onEdit.exemptFields`). Key order does not matter; a snapshot
 * stored as JSON text is read as the value it holds. A top-level field holding no value (null) is
 * left out like one that is absent: a version recorded at create leaves out a translated field
 * never set, while one recorded by a later save holds it as null, and the two are the same content.
 *
 * The one digest an approval is given with and a later save is compared against, so the two
 * leave out exactly the same fields.
 */
export function approvalDigest(
  snapshot: unknown,
  entity: SystemColumnEntity,
  exemptFields: readonly string[] = []
): string {
  return digestLeavingOut(snapshot, keysLeftOut(entity), exemptFields);
}

/**
 * Whether `snapshot` is still the content an approval with digest `stored` approved: its digest
 * now, or the digest earlier releases gave an approval, which left out the framework's keys every
 * comparison leaves out (`documentSystemKeys`) and no other framework column. An approval given
 * before an upgrade is then kept through a save that changes none of its content, and is still
 * withdrawn by one that does.
 */
export function stillApproved(
  stored: string,
  snapshot: unknown,
  entity: SystemColumnEntity,
  exemptFields: readonly string[] = []
): boolean {
  return (
    stored === approvalDigest(snapshot, entity, exemptFields) ||
    stored ===
      digestLeavingOut(snapshot, LEGACY_DIGEST_KEYS[entity], exemptFields)
  );
}

/**
 * The keys an approval's digest left out before it left out every framework column (alpha.74 and
 * alpha.75): the document's system keys as those releases listed them. Spelled out rather than read
 * from `documentSystemKeys`, so a later change to that list cannot change what a digest those
 * releases stored is compared with.
 */
const LEGACY_SHARED_DIGEST_KEYS = [
  "id",
  "createdAt",
  "updatedAt",
  "status",
  "_rev",
  "_revision",
  "_changed_by_kind",
  "_changed_by_id",
  "_changed_by_principal_kind",
  "_changed_at",
];
const LEGACY_DIGEST_KEYS: Readonly<
  Record<SystemColumnEntity, ReadonlySet<string>>
> = {
  // A Single has no owner column, so a field it declares under that name is content.
  collection: new Set([...LEGACY_SHARED_DIGEST_KEYS, "createdBy"]),
  single: new Set(LEGACY_SHARED_DIGEST_KEYS),
};

/** The digest of `snapshot` without the top-level keys `system` and `exemptFields` name. */
function digestLeavingOut(
  snapshot: unknown,
  system: ReadonlySet<string>,
  exemptFields: readonly string[]
): string {
  const value = readSnapshot(snapshot);
  const exempt = new Set(exemptFields);
  // Only the top level carries the framework's keys and the exempt fields, which are named by a
  // top-level field name; nested content is the editor's.
  const content =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            ([key, held]) =>
              !system.has(key) &&
              !exempt.has(key) &&
              held !== null &&
              held !== undefined
          )
        )
      : value;
  return createHash("sha256")
    .update(canonicalJson(content) ?? "", "utf8")
    .digest("hex");
}

/**
 * The top-level keys a digest leaves out for a document of this kind: the framework's own keys
 * every comparison leaves out (`documentSystemKeys`), and every framework column no client may
 * write, in both spellings, since none of them is content an approval covers. Among those is when
 * the document was first published, which SQLite and MySQL read back to the second while the
 * version a publish writes holds it to the millisecond: counted, it would read as a change between
 * two versions nobody edited.
 */
function keysLeftOut(entity: SystemColumnEntity): ReadonlySet<string> {
  // The framework columns no client writes come from the one projection of them
  // (`immutableSystemColumnNames`, both spellings), not a copy of it.
  return new Set([
    ...documentSystemKeys(entity),
    ...immutableSystemColumnNames(entity),
  ]);
}

/** A snapshot as the value it holds: stored as JSON text by some dialects. */
function readSnapshot(snapshot: unknown): unknown {
  if (typeof snapshot !== "string") return snapshot;
  try {
    return JSON.parse(snapshot) as unknown;
  } catch (error) {
    // A snapshot that is not JSON cannot be approved as any content.
    throw NextlyError.internal({
      cause: error instanceof Error ? error : undefined,
      logContext: { reason: "approval-snapshot-unreadable" },
    });
  }
}

/**
 * The list filter keeping entries of one collection with a part changed since its last approval:
 * a part whose approved pin (`approved:<part>`, which a step's approval sets, a withdrawal keeps
 * and a publish releases) names a version older than the newest the part has recorded. The same
 * pin the history's "Since approved" comparison reads, and the same newest version a review shows
 * (`shownVersionOn`): a language's own newest version, and for the shared part the newest in any
 * language. A correlated `EXISTS` over the pins and the versions, so the page and its count read
 * one condition.
 *
 * @module domains/workflows/changed-since-approved-condition
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  like,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { versionPinsTables } from "../../schemas/version-pins";
import { versionsTables } from "../../schemas/versions";

import { workflowAttachedTo } from "./registry";
import { approvedSlot, WORKFLOW_PIN_HOLDER } from "./workflow-pins";

/**
 * The condition keeping entries of `collectionName` with a part changed since its last approval,
 * among the languages `locales` names and the shared part (`null` considers every language, as the
 * other workflow filters take it). A collection no workflow is attached to was never approved, and
 * keeps no entry.
 */
export function changedSinceApprovedCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  entryId: SQLWrapper;
  locales: readonly string[] | null;
}): SQL {
  const pins = versionPinsTables(args.dialect).nextlyVersionPins;
  const versions = versionsTables(args.dialect).nextlyVersions;
  if (!workflowAttachedTo("collection", args.collectionName)) {
    return inArray(pins.slot, []);
  }
  // Every slot an approval names starts with this; what follows it is the part's language, or
  // the shared part's token. Derived from the slot's one spelling, never written out here.
  const prefix = approvedSlot("");
  const sharedSlot = approvedSlot(null);
  // A newer version of the part the pin names: any language for the shared part, else the pin's
  // own language, read from the slot after its prefix (`SUBSTR` reads alike on every dialect).
  const newer = sql`EXISTS (SELECT 1 FROM ${versions} WHERE ${and(
    eq(versions.scopeKind, "collection"),
    eq(versions.scopeSlug, args.collectionName),
    eq(versions.entryId, args.entryId),
    eq(versions.isAutosave, false),
    isNotNull(versions.versionNo),
    gt(versions.versionNo, pins.versionNo),
    or(
      eq(pins.slot, sharedSlot),
      eq(versions.locale, sql`SUBSTR(${pins.slot}, ${prefix.length + 1})`)
    )
  )})`;
  return sql`EXISTS (SELECT 1 FROM ${pins} WHERE ${and(
    eq(pins.scopeKind, "collection"),
    eq(pins.scopeSlug, args.collectionName),
    eq(pins.entryId, args.entryId),
    eq(pins.holder, WORKFLOW_PIN_HOLDER),
    // Only an approval's slots. The language match above already reads nothing from another
    // slot's suffix today; this keeps it so whatever slots the holder comes to hold.
    args.locales === null
      ? like(pins.slot, `${prefix}%`)
      : inArray(pins.slot, [sharedSlot, ...args.locales.map(approvedSlot)]),
    newer
  )})`;
}

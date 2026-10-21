/**
 * The base of a pending change: the version it began from, as far as the
 * fields every language shares are concerned.
 *
 * A language's pending change holds a whole copy of the document, shared
 * fields included, and publishing it writes those shared values onto the live
 * row. When another language published a newer shared value after the change
 * began, that write would put the older value back. So each pending change
 * records its base, and a shared field whose live value has moved off the
 * base is out of date: the publish is refused, naming it, and nothing is
 * merged on the editor's behalf. Taking the live values brings the change up
 * to date and moves its base.
 *
 * The base is a version, held as a version pin, so retention never removes
 * the copy the comparison reads. It is the newest version whose shared values
 * equal the live row's, not merely the newest published one: a language that
 * is not published yet saves in place, which changes the live shared values
 * with no publish, and the version that save recorded is then the one that
 * matches. A pending change with no base (saved before bases were recorded,
 * or begun when no version matched) compares its own shared values with live
 * instead, which errs towards naming a field rather than reverting one.
 *
 * @module domains/versions/shared-publish-base
 * @experimental
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { NextlyError } from "../../errors";
import {
  applyFieldReadAccess,
  type CallerGrants,
} from "../../shared/lib/field-level-registry";

import { registerVersionPinHolder, versionPins } from "./version-pins";
import { VersionsRepository, type VersionRef } from "./versions-repository";

const VERSIONS_TABLE = "nextly_versions";

/** How far back the base is looked for: the versions retention most often keeps. */
const BASE_SEARCH_DEPTH = 25;

const baseHolder = registerVersionPinHolder({
  name: "shared-publish-base",
  label: "Pending changes",
});

/** The slot a pending change's base is pinned under: one per language. */
function slotOf(locale: string | null): string {
  return `pending:${locale ?? ""}`;
}

/**
 * A container a row may hold as JSON text and a snapshot as its parsed value:
 * the parsed value either way, so the two compare equal.
 */
function parsedContainer(value: unknown): unknown {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * A stored value in one comparable form. A version's snapshot went through
 * JSON on its way into storage, so the live row's value is put through the
 * same: a date becomes its ISO string, a container held as text is parsed,
 * and object keys are ordered, so two copies of one value compare equal
 * however each was produced.
 */
function comparable(value: unknown): string {
  return JSON.stringify(
    parsedContainer(value) ?? null,
    (_key, inner: unknown) => {
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        );
      }
      return inner;
    }
  );
}

/**
 * The fields every language of a localized document shares: those its
 * translations table does not hold, narrowed to the keys the document
 * carries, so a value kept in tables of its own is compared only where the
 * document holds it.
 */
export function sharedFieldNames(
  fields: ReadonlyArray<{ name?: string }>,
  localized: ReadonlySet<string>,
  document: Record<string, unknown>
): string[] {
  return fields.flatMap(field =>
    typeof field.name === "string" &&
    !localized.has(field.name) &&
    field.name in document
      ? [field.name]
      : []
  );
}

/** The shared fields whose values differ between two copies of a document. */
export function differingFields(
  shared: readonly string[],
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string[] {
  return shared.filter(name => comparable(a[name]) !== comparable(b[name]));
}

/** A stored snapshot as a record, whether the driver parsed its JSON or not. */
export function snapshotRecord(value: unknown): Record<string, unknown> {
  const parsed: unknown =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * Pin a pending change's base: the newest version whose shared values equal
 * the live document's. With none (versions captured before this document's
 * shared values last changed, or pruned), any pin the slot held is released,
 * so the change is judged as one without a base rather than against a stale
 * one.
 *
 * @param live The live document, shaped as a version snapshot is.
 */
export async function recordSharedBase(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    live: Record<string, unknown>;
  }
): Promise<void> {
  const { ref, locale, shared, live } = args;
  const recent = await tx.select<{ versionNo: number; snapshot: unknown }>(
    VERSIONS_TABLE,
    {
      columns: ["versionNo", "snapshot"],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: ref.scopeKind },
          { column: "scopeSlug", op: "=", value: ref.scopeSlug },
          { column: "entryId", op: "=", value: ref.entryId },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NOT NULL" },
        ],
      },
      orderBy: [{ column: "versionNo", direction: "desc" }],
      limit: BASE_SEARCH_DEPTH,
    }
  );
  const match = recent.find(
    row =>
      differingFields(shared, snapshotRecord(row.snapshot), live).length === 0
  );
  const slot = slotOf(locale);
  if (match) {
    await baseHolder.pin(tx, { ref, slot, versionNo: match.versionNo });
  } else {
    await baseHolder.release(tx, { ref, slot });
  }
}

/**
 * The refusal of a pending change holding out-of-date shared values: a
 * conflict naming each field the caller may read. One it may not read is
 * counted instead, so a refusal never reveals that a protected field exists.
 *
 * @param live The live document the fields were judged against, which the
 *   field read rules are shown.
 * @param grants The caller's grants, resolved before any transaction this
 *   runs in, since resolving them takes a pooled connection.
 */
export async function sharedValuesConflict(args: {
  kind: "collection" | "single";
  slug: string;
  entryId: string;
  fields: readonly string[];
  live: Record<string, unknown>;
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
  authenticatedScope?: AuthenticatedScope;
  grants?: () => Promise<CallerGrants>;
}): Promise<NextlyError> {
  const readable = { ...args.live };
  await applyFieldReadAccess({
    kind: args.kind,
    slug: args.slug,
    entry: readable,
    user: args.user,
    authenticatedScope: args.authenticatedScope,
    overrideAccess: args.overrideAccess,
    grants: args.grants,
  });
  const named = args.fields.filter(name => name in readable);
  const hidden = args.fields.length - named.length;
  return NextlyError.conflict({
    reason: "state",
    message:
      "Shared values were published by someone else after this change began. Take the live values for them, then publish.",
    data: {
      outOfDate: named,
      ...(hidden > 0 ? { hiddenOutOfDate: hidden } : {}),
    },
    logContext: {
      reason: "shared-values-out-of-date",
      kind: args.kind,
      slug: args.slug,
      entryId: args.entryId,
      fields: args.fields,
    },
  });
}

/** Free every language's base on a document, once all its changes are published. */
export async function releaseAllSharedBases(
  tx: TransactionContext,
  ref: VersionRef
): Promise<void> {
  await baseHolder.releaseAll(tx, ref);
}

/** Free a pending change's base, once the change is published or discarded. */
export async function releaseSharedBase(
  tx: TransactionContext,
  ref: VersionRef,
  locale: string | null
): Promise<void> {
  await baseHolder.release(tx, { ref, slot: slotOf(locale) });
}

/**
 * The shared fields a pending change may not publish: those whose live value
 * has moved off the change's base. A change with no base compares its own
 * values with live instead.
 *
 * @param live The live document, shaped as a version snapshot is.
 * @param pending The pending change's snapshot.
 */
export async function outOfDateSharedFields(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    live: Record<string, unknown>;
    pending: Record<string, unknown>;
  }
): Promise<string[]> {
  const { ref, locale, shared, live, pending } = args;
  const slot = slotOf(locale);
  const pin = (await versionPins.list(tx, ref)).find(
    p => p.holder === "shared-publish-base" && p.slot === slot
  );
  if (!pin) {
    // Only the fields the change holds: a snapshot without a field writes
    // nothing to it.
    return differingFields(
      shared.filter(name => name in pending),
      pending,
      live
    );
  }
  const base = await tx.select<{ snapshot: unknown }>(VERSIONS_TABLE, {
    columns: ["snapshot"],
    where: {
      and: [
        { column: "scopeKind", op: "=", value: ref.scopeKind },
        { column: "scopeSlug", op: "=", value: ref.scopeSlug },
        { column: "entryId", op: "=", value: ref.entryId },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "=", value: pin.versionNo },
      ],
    },
    limit: 1,
  });
  return differingFields(shared, snapshotRecord(base[0]?.snapshot), live);
}

/**
 * Bring a pending change up to date: write the live value of each out-of-date
 * shared field into it, and move its base to the version those live values
 * are in. Returns the fields taken; the change's other values stay its own.
 *
 * @param live The live document, shaped as a version snapshot is.
 */
export async function takeLiveSharedValuesInto(
  tx: TransactionContext,
  args: {
    ref: VersionRef;
    locale: string | null;
    shared: readonly string[];
    live: Record<string, unknown>;
    pending: Record<string, unknown>;
    createdBy: string | null;
  }
): Promise<string[]> {
  const { ref, locale, shared, live, pending, createdBy } = args;
  const stale = await outOfDateSharedFields(tx, {
    ref,
    locale,
    shared,
    live,
    pending,
  });
  await new VersionsRepository(tx).upsertWorkingDraft({
    ref,
    locale,
    snapshot: {
      ...pending,
      ...Object.fromEntries(stale.map(name => [name, live[name]])),
    },
    createdBy,
  });
  await recordSharedBase(tx, { ref, locale, shared, live });
  return stale;
}

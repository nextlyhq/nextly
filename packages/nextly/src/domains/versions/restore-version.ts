/**
 * Putting a document back to an earlier version.
 *
 * A restore is an ordinary write. It loads snapshot vN, decides what of it may
 * be resubmitted, and sends that through the same update path a human edit
 * uses, so validation, hooks, component and many-to-many writes, events and the
 * outbox all behave identically. The write records `sourceVersionNo`, which is
 * the only thing distinguishing it afterwards.
 *
 * History is never rewritten: restoring produces a new version rather than
 * removing the ones after it, so a restore made in error is undone by restoring
 * again.
 *
 * @module domains/versions/restore-version
 */

import type { RequestActor } from "../../auth/request-actor";
import type { FieldConfig } from "../../collections/fields/types";
import { getService } from "../../di";
import { NextlyError } from "../../errors";
import type { VersionScopeKind } from "../../schemas/versions/types";
import type { UserContext } from "../singles/types";

import { buildRestorePayload, canRestoreLocale } from "./restore-snapshot";

export interface RestoreVersionArgs {
  scopeKind: VersionScopeKind;
  slug: string;
  entryId: string;
  versionNo: number;
  user: UserContext;
  /**
   * Who performed the write, recorded on the outbox event. Forwarded so an
   * API-key restore is attributed to the key rather than to its owner, which
   * would make it indistinguishable from that person editing by hand.
   */
  actor?: RequestActor;
}

export interface RestoreVersionResult {
  /** The version that was restored from. */
  restoredFrom: number;
  /**
   * Snapshot keys the current schema no longer has. Surfaced so a caller can
   * tell the editor what could not come back, rather than reporting a restore
   * that silently left parts behind.
   */
  droppedFields: string[];
}

/** Current field configs and whether the entity stores values per locale. */
async function describeEntity(
  scopeKind: VersionScopeKind,
  slug: string
): Promise<{ fields: FieldConfig[]; localized: boolean; hasStatus: boolean }> {
  if (scopeKind === "single") {
    const registry = getService("singleRegistryService");
    const record = await registry.getSingleBySlug(slug);
    return {
      fields: record?.fields ?? [],
      localized: Boolean(record?.localized),
      hasStatus: Boolean(record?.status),
    };
  }

  const collections = getService("collectionService");
  const collection = await collections.getCollection(slug, {});
  const record = collection as {
    fields?: unknown[];
    localized?: boolean;
    status?: boolean;
  } | null;

  return {
    fields: (record?.fields ?? []) as FieldConfig[],
    localized: Boolean(record?.localized),
    hasStatus: Boolean(record?.status),
  };
}

/**
 * Restore `versionNo` onto the live document.
 *
 * The caller is expected to have already established that this user may read
 * the document's history and may update the document; this performs the write
 * with access still enforced, so a mistake upstream cannot escalate.
 */
export async function restoreVersion(
  args: RestoreVersionArgs
): Promise<RestoreVersionResult> {
  if (!Number.isInteger(args.versionNo) || args.versionNo < 1) {
    throw NextlyError.validation({
      errors: [
        {
          path: "versionNo",
          code: "INVALID_VALUE",
          message: "Version number must be a positive integer.",
        },
      ],
    });
  }

  const versions = getService("versionsService");
  const version = await versions.get(
    {
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
    args.versionNo
  );

  const { fields, localized, hasStatus } = await describeEntity(
    args.scopeKind,
    args.slug
  );

  // A localized snapshot holds exactly one locale's values. Writing one that
  // does not say which would put a language's content into whichever locale
  // happens to be the default, so it is refused rather than guessed.
  if (!canRestoreLocale(localized, version.locale)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "versionNo",
          code: "LOCALE_UNKNOWN",
          message:
            "This version does not record which language it holds, so it cannot be restored.",
        },
      ],
      logContext: {
        reason: "restore-locale-unknown",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
        versionNo: args.versionNo,
      },
    });
  }

  const { payload, droppedFields } = buildRestorePayload(
    version.snapshot,
    fields,
    { hasStatus }
  );

  if (Object.keys(payload).length === 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "versionNo",
          code: "NOTHING_TO_RESTORE",
          message:
            "No part of this version can be applied to the current schema.",
        },
      ],
      logContext: {
        reason: "restore-empty-payload",
        droppedFields,
        versionNo: args.versionNo,
      },
    });
  }

  if (args.scopeKind === "single") {
    const singles = getService("singleEntryService");
    const result = await singles.update(args.slug, payload, {
      user: args.user,
      overrideAccess: false,
      // The route authorized the caller for this document; the update still
      // runs its own document-level rules.
      routeAuthorized: true,
      ...(version.locale ? { locale: version.locale } : {}),
      sourceVersionNo: args.versionNo,
    });
    assertWriteSucceeded(result, args);
  } else {
    const collections = getService("collectionsHandler");
    const result = await collections.updateEntry(
      {
        collectionName: args.slug,
        entryId: args.entryId,
        user: args.user,
        overrideAccess: false,
        routeAuthorized: true,
        ...(version.locale ? { locale: version.locale } : {}),
        ...(args.actor ? { actor: args.actor } : {}),
        sourceVersionNo: args.versionNo,
      },
      payload
    );
    assertWriteSucceeded(result, args);
  }

  return { restoredFrom: args.versionNo, droppedFields };
}

/**
 * The update services report failure in their result rather than throwing, so a
 * failed restore must not return as though it succeeded.
 */
function assertWriteSucceeded(
  result: { success?: boolean; statusCode?: number; message?: string },
  args: RestoreVersionArgs
): void {
  // Fail closed: a result that does not explicitly report success is treated
  // as failure, so a path that omits the field cannot report a restore that
  // never happened.
  if (result.success === true) return;

  if (result.statusCode === 403 || result.statusCode === 404) {
    throw NextlyError.notFound({
      logContext: {
        reason: "restore-write-denied",
        statusCode: result.statusCode,
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
      },
    });
  }

  throw NextlyError.internal({
    logContext: {
      reason: "restore-write-failed",
      statusCode: result.statusCode,
      message: result.message,
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
  });
}

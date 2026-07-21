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
import { applyFieldWriteAccess } from "../../shared/lib/field-level-registry";
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
interface EntityDescription {
  fields: FieldConfig[];
  localized: boolean;
  hasStatus: boolean;
  /** Whether versions are still being captured for this entity. */
  versioningEnabled: boolean;
  /**
   * Plugin collections get no synthesized `title`/`slug` columns — the update
   * path makes the same distinction before touching a slug.
   */
  isPlugin: boolean;
}

async function describeEntity(
  scopeKind: VersionScopeKind,
  slug: string
): Promise<EntityDescription> {
  // Read from the registry rather than the metadata service: the latter
  // injects synthetic `title`/`slug` field definitions for the entry form, so
  // its field list would report columns a plugin collection's table does not
  // actually have.
  const record =
    scopeKind === "single"
      ? await getService("singleRegistryService").getSingleBySlug(slug)
      : ((await getService("collectionRegistryService").getCollectionBySlug(
          slug
        )) as unknown);

  const shape = record as {
    fields?: unknown[];
    localized?: boolean;
    status?: boolean;
    versions?: { enabled?: boolean } | null;
    admin?: { isPlugin?: boolean } | null;
  } | null;

  return {
    fields: (shape?.fields ?? []) as FieldConfig[],
    localized: Boolean(shape?.localized),
    hasStatus: Boolean(shape?.status),
    versioningEnabled: Boolean(shape?.versions?.enabled),
    isPlugin: shape?.admin?.isPlugin === true,
  };
}

/**
 * Child fields for every component the schema references, keyed by slug.
 *
 * A component field names its schema rather than carrying it, so the payload
 * filter cannot see inside one without this. A component that fails to load is
 * simply absent, which makes the filter treat that subtree as unknown and drop
 * it — the safe direction, since resubmitting a subtree it cannot inspect could
 * overwrite a nested credential.
 */
async function resolveComponentFields(
  fields: FieldConfig[]
): Promise<Map<string, FieldConfig[]>> {
  const slugs = new Set<string>();

  const collect = (list: FieldConfig[]): void => {
    for (const field of list) {
      const one = (field as { component?: unknown }).component;
      const many = (field as { components?: unknown }).components;
      if (typeof one === "string") slugs.add(one);
      if (Array.isArray(many)) {
        for (const slug of many) if (typeof slug === "string") slugs.add(slug);
      }
      const nested = (field as { fields?: unknown }).fields;
      if (Array.isArray(nested)) collect(nested as FieldConfig[]);
    }
  };
  collect(fields);

  const resolved = new Map<string, FieldConfig[]>();
  if (slugs.size === 0) return resolved;

  const registry = getService("componentRegistryService");

  // A component may embed another, so resolving only the entity's own layer
  // would leave the deeper ones opaque — and an opaque subtree is one the
  // filter can neither inspect for credentials nor prune. Resolve until no
  // new slug is discovered; the `resolved` map doubles as the visited set, so
  // a cycle terminates.
  let pending = [...slugs];
  while (pending.length > 0) {
    const batch = pending.filter(slug => !resolved.has(slug));
    if (batch.length === 0) break;

    await Promise.all(
      batch.map(async slug => {
        try {
          const record = await registry.getComponentBySlug(slug);
          resolved.set(slug, record?.fields ?? []);
        } catch {
          // Recorded as empty so the slug is not retried; an unresolved
          // subtree is treated as unknown and dropped, which is the safe
          // direction. See the note above.
          resolved.set(slug, []);
        }
      })
    );

    const discovered = new Set<string>();
    for (const slug of batch) {
      const collected = new Set<string>();
      const gather = (list: FieldConfig[]): void => {
        for (const field of list) {
          const one = (field as { component?: unknown }).component;
          const many = (field as { components?: unknown }).components;
          if (typeof one === "string") collected.add(one);
          if (Array.isArray(many)) {
            for (const s of many) if (typeof s === "string") collected.add(s);
          }
          const nested = (field as { fields?: unknown }).fields;
          if (Array.isArray(nested)) gather(nested as FieldConfig[]);
        }
      };
      gather(resolved.get(slug) ?? []);
      for (const s of collected) if (!resolved.has(s)) discovered.add(s);
    }

    pending = [...discovered];
  }

  return resolved;
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

  const { fields, localized, hasStatus, versioningEnabled, isPlugin } =
    await describeEntity(args.scopeKind, args.slug);

  // The write goes through the ordinary update, which captures a version only
  // while versioning is on. With it off, a restore would overwrite live content
  // without preserving the state it replaced and without recording that it
  // happened — turning a recoverable action into a destructive one.
  if (!versioningEnabled) {
    throw NextlyError.validation({
      errors: [
        {
          path: "versionNo",
          code: "VERSIONING_DISABLED",
          message:
            "Versioning is turned off for this content, so a restore could not be recorded.",
        },
      ],
      logContext: {
        reason: "restore-versioning-disabled",
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
      },
    });
  }

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

  const componentFields = await resolveComponentFields(fields);
  const declared = new Set(fields.map(f => f.name));

  const { payload, droppedFields } = buildRestorePayload(
    version.snapshot,
    fields,
    {
      hasStatus,
      // Synthesized for ordinary entities, but a plugin collection has these
      // columns only when it declares them as fields — the same distinction the
      // update path makes before it touches a slug.
      hasSlug: isPlugin ? declared.has("slug") : true,
      hasTitle: isPlugin ? declared.has("title") : true,
      componentFields,
    }
  );

  // Field-level write rules strip denied keys inside the update path, silently
  // and after it has already reported success. Evaluating the same rules here
  // — against a copy, so nothing is mutated — turns that into something the
  // caller can be told about instead of a restore that reports success for
  // content it never applied.
  const accessProbe: Record<string, unknown> = { ...payload };
  try {
    await applyFieldWriteAccess({
      kind: args.scopeKind === "single" ? "single" : "collection",
      slug: args.slug,
      data: accessProbe,
      operation: "update",
      user: args.user,
      overrideAccess: false,
      id: args.entryId,
    });
    for (const key of Object.keys(payload)) {
      if (!(key in accessProbe)) {
        delete payload[key];
        droppedFields.push(key);
      }
    }
  } catch {
    // A failure here must not block a restore the update path would allow; the
    // update evaluates the same rules again and remains the authority.
  }

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
      // Forwarded only while the entity still stores values per locale. A
      // document since un-localized needs no write locale, and an old
      // version's locale may no longer be configured at all — which the update
      // path would reject outright.
      ...(localized && version.locale ? { locale: version.locale } : {}),
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
        // See the Single branch: only while the entity is still localized.
        ...(localized && version.locale ? { locale: version.locale } : {}),
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
  result: {
    success?: boolean;
    statusCode?: number;
    message?: string;
    errors?: unknown;
  },
  args: RestoreVersionArgs
): void {
  // Fail closed: a result that does not explicitly report success is treated
  // as failure, so a path that omits the field cannot report a restore that
  // never happened.
  if (result.success === true) return;

  const status = result.statusCode ?? 500;

  if (status === 403 || status === 404) {
    throw NextlyError.notFound({
      logContext: {
        reason: "restore-write-denied",
        statusCode: status,
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
      },
    });
  }

  // A snapshot can fail today's rules for ordinary reasons — a select option
  // since removed, a slug that now collides, a validator tightened since. Those
  // are answers the editor can act on, so the update's own status and message
  // are preserved rather than flattened into a server fault.
  if (status >= 400 && status < 500) {
    throw NextlyError.validation({
      errors: Array.isArray(result.errors)
        ? (result.errors as { path: string; code: string; message: string }[])
        : [
            {
              path: "versionNo",
              code: status === 409 ? "CONFLICT" : "RESTORE_REJECTED",
              message:
                result.message ??
                "This version could not be applied to the document as it is now.",
            },
          ],
      logContext: {
        reason: "restore-write-rejected",
        statusCode: status,
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
      },
    });
  }

  throw NextlyError.internal({
    logContext: {
      reason: "restore-write-failed",
      statusCode: status,
      message: result.message,
      scopeKind: args.scopeKind,
      scopeSlug: args.slug,
      entryId: args.entryId,
    },
  });
}

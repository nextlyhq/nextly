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

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { RequestActor } from "../../auth/request-actor";
import type { FieldConfig } from "../../collections/fields/types";
import { getService } from "../../di";
import { NextlyError } from "../../errors";
import type { VersionScopeKind } from "../../schemas/versions/types";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
} from "../../shared/lib/field-level-registry";
import { isValidLocale } from "../i18n/resolve-locale";
import type { UserContext } from "../singles/types";

import {
  buildRestorePayload,
  payloadTouchesComponents,
  restoreLocaleIsUnknown,
  schemaStoresPerLocaleContent,
  type ComponentSchemas,
} from "./restore-snapshot";

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
  /**
   * The caller's authenticated scope. A restore replays a snapshot through the
   * update path, so when the snapshot sets `status: "published"` it hits the
   * publish transition gate — which for a scoped API key must judge the key's
   * OWN `publish-<slug>` grant, not the owner's RBAC.
   */
  authenticatedScope?: AuthenticatedScope;
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
async function resolveComponentSchemas(
  fields: FieldConfig[]
): Promise<ComponentSchemas> {
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

  const resolved: ComponentSchemas = new Map();
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
          // The component's OWN localization switch: its values live in its own
          // tables, so an unlocalized component inside a localized document
          // stores one copy of each value. A slug with no record behind it is
          // marked unresolved rather than empty — a component that declares no
          // fields is legitimate and must stay restorable.
          resolved.set(slug, {
            fields: record?.fields ?? [],
            localized:
              (record as { localized?: unknown } | null)?.localized === true,
            resolved: record !== null && record !== undefined,
          });
        } catch {
          // Recorded as empty so the slug is not retried; an unresolved
          // subtree is treated as unknown and dropped, which is the safe
          // direction. See the note above.
          resolved.set(slug, { fields: [], localized: false, resolved: false });
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
      gather(resolved.get(slug)?.fields ?? []);
      for (const s of collected) if (!resolved.has(s)) discovered.add(s);
    }

    pending = [...discovered];
  }

  return resolved;
}

/**
 * The version's locale, when the app still configures it.
 *
 * Locales come and go from configuration. A version captured under one that has
 * since been removed names a language nothing can be written to, so it is
 * treated the same as a version that never recorded one.
 */
function usableLocale(versionLocale: string | null): string | null {
  if (versionLocale === null) return null;
  const localization = getService("config")?.localization;
  // Without localization configured there is no locale to validate against, and
  // nothing reads one either.
  if (!localization) return null;
  return isValidLocale(localization, versionLocale) ? versionLocale : null;
}

/**
 * Remove from `payload` every key an access probe changed, reporting each.
 *
 * The read and write rules are evaluated separately but answered the same way:
 * a key the probe dropped, or a container it altered, is one this caller may
 * not carry. Holding a changed container back whole is deliberate — submitting
 * it half-stripped would overwrite the live value with a partial one, which is
 * worse than not restoring the field.
 *
 * Shared so the two probes cannot drift apart, which is the failure this file
 * has already seen more than once.
 */
function dropFieldsTheProbeRejected(
  payload: Record<string, unknown>,
  probe: Record<string, unknown>,
  droppedFields: string[]
): void {
  for (const key of Object.keys(payload)) {
    if (!(key in probe) || !deepEquals(payload[key], probe[key])) {
      delete payload[key];
      droppedFields.push(key);
    }
  }
}

/**
 * Structural equality for payload values.
 *
 * Used to tell whether field-level rules changed a container while probing.
 * Snapshot values are JSON, so key order is the only ambiguity and comparing
 * sorted keys settles it.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, i) => deepEquals(item, b[i]));
  }

  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (!aKeys.every((key, i) => key === bKeys[i])) return false;

  return aKeys.every(key =>
    deepEquals(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
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

  // A localized snapshot holds one locale's values, and a version that records
  // none cannot say whose. Rather than refuse the whole restore, the per-locale
  // part is left alone and the shared fields are applied — a version produced by
  // a shared-field-only edit then restores exactly what it captured. Whatever is
  // held back is reported; a snapshot with nothing shared left falls through to
  // the empty-payload refusal below.
  // A locale the app no longer configures cannot be written: both update paths
  // reject an unknown one, so carrying it would fail the whole restore instead
  // of applying the shared fields it could still bring back.
  const storedLocale = usableLocale(version.locale);

  const componentSchemas = await resolveComponentSchemas(fields);

  // Per-locale content is not only the document's own. An unlocalized document
  // embedding a localized component still holds values that belong to one
  // language, and writing them with no locale resolves the default one — so a
  // German component snapshot would land on top of the default language.
  const perLocaleContent = schemaStoresPerLocaleContent(
    localized,
    fields,
    componentSchemas
  );
  const localeUnknown = restoreLocaleIsUnknown(perLocaleContent, storedLocale);
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
      componentSchemas,
      documentLocalized: localized,
      localeUnknown,
    }
  );

  // Field-level READ rules decide what of the snapshot this caller was ever
  // allowed to see. A field hidden from them must not be written back from a
  // version they could not have read — the history endpoints redact the same
  // snapshot before returning it, and restoring is the one path that would
  // otherwise apply it unredacted.
  //
  // Probed on a deep copy for the same reason as the write rules below: these
  // strip nested keys in place.
  //
  // The probe carries the document's id, which the payload deliberately does
  // not: `id` is immutable and was stripped before this point. A rule keyed on
  // the document — owner-only visibility, say — would otherwise evaluate with
  // no id and hide fields the same caller can read in version history, making
  // restore stricter than the endpoint the snapshot came from.
  const readProbe: Record<string, unknown> = {
    ...structuredClone(payload),
    id: args.entryId,
  };
  try {
    await applyFieldReadAccess({
      kind: args.scopeKind === "single" ? "single" : "collection",
      slug: args.slug,
      entry: readProbe,
      user: args.user,
      overrideAccess: false,
    });
    dropFieldsTheProbeRejected(payload, readProbe, droppedFields);
  } catch {
    // A failure here must not block a restore the update path would allow; the
    // write rules below remain the authority on what may be applied.
  }

  // Field-level write rules strip denied keys inside the update path, silently
  // and after it has already reported success. Evaluating the same rules here
  // — against a copy, so nothing is mutated — turns that into something the
  // caller can be told about instead of a restore that reports success for
  // content it never applied.
  //
  // The copy is deep. These rules strip nested keys by mutating the container
  // in place, so a shallow copy would share every group and repeater with the
  // real payload: the probe would edit the very thing it is meant to leave
  // alone, and the comparison below — which walks keys, not identity — would
  // see the two agreeing and report nothing.
  const accessProbe: Record<string, unknown> = structuredClone(payload);
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
    dropFieldsTheProbeRejected(payload, accessProbe, droppedFields);
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
            "No part of this version can be applied to the document as it is now.",
        },
      ],
      logContext: {
        reason: "restore-empty-payload",
        droppedFields,
        localeUnknown,
        versionNo: args.versionNo,
      },
    });
  }

  // The locale to write at. A document that stores its own translations needs
  // one; so does a payload carrying component values, because components keep
  // per-locale rows of their own even when their parent is not localized —
  // without it the save path resolves the default language and a translation
  // restores over the wrong one. A document since un-localized whose payload
  // reaches no component needs none, and passing a stale one would be rejected.
  const writeLocale =
    storedLocale !== null &&
    (localized || payloadTouchesComponents(payload, fields))
      ? storedLocale
      : null;

  if (args.scopeKind === "single") {
    const singles = getService("singleEntryService");
    const result = await singles.update(args.slug, payload, {
      user: args.user,
      overrideAccess: false,
      // The route authorized the caller for this document; the update still
      // runs its own document-level rules.
      routeAuthorized: true,
      // Forward the actor so an API-key restore is attributed to the key, not
      // its owner — mirrors the collection branch below.
      ...(args.actor ? { actor: args.actor } : {}),
      // A snapshot that restores `status: "published"` must satisfy the key's
      // own publish grant, not the owner's RBAC.
      ...(args.authenticatedScope
        ? { authenticatedScope: args.authenticatedScope }
        : {}),
      ...(writeLocale ? { locale: writeLocale } : {}),
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
        // A snapshot that restores `status: "published"` must satisfy the key's
        // own publish grant, not the owner's RBAC.
        ...(args.authenticatedScope
          ? { authenticatedScope: args.authenticatedScope }
          : {}),
        // See the note above the Single branch.
        ...(writeLocale ? { locale: writeLocale } : {}),
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

  // A conflict stays a conflict. Wrapping it in a validation error would answer
  // 400/VALIDATION_ERROR, and a REST client reads the outer status — so a
  // restore whose slug now collides would stop matching the contract the same
  // collision reports through an ordinary update.
  if (status === 409) {
    throw NextlyError.conflict({
      logContext: {
        reason: "restore-write-conflict",
        message: result.message,
        scopeKind: args.scopeKind,
        scopeSlug: args.slug,
        entryId: args.entryId,
      },
    });
  }

  // A snapshot can fail today's rules for ordinary reasons — a select option
  // since removed, a validator tightened since. Those are answers the editor can
  // act on, so the update's own message is preserved rather than flattened into
  // a server fault.
  if (status >= 400 && status < 500) {
    throw NextlyError.validation({
      errors: Array.isArray(result.errors)
        ? (result.errors as { path: string; code: string; message: string }[])
        : [
            {
              path: "versionNo",
              code: "RESTORE_REJECTED",
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

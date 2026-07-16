/**
 * Availability of the visual schema builder.
 *
 * The builder issues DDL (create/alter/drop) against the live database from a
 * browser, with no migration to review and no rollback. That is fine while
 * developing and dangerous against a deployed site, so it is off by default in
 * production and the schema-mutation endpoints refuse there — hiding the
 * navigation alone would leave the endpoints reachable by URL.
 *
 * Reading entities stays open in every environment: production still lists
 * collections and singles to manage their entries.
 */

import { NextlyError } from "../errors/nextly-error";
import { getHandlerConfig } from "../route-handler/auth-handler";

/**
 * Whether the schema builder (and its mutation endpoints) is available.
 *
 * Precedence:
 * 1. `admin.branding.showBuilder`, when the host sets it explicitly.
 * 2. `NODE_ENV`: enabled everywhere except production.
 */
export function isBuilderEnabled(): boolean {
  const showBuilder = getHandlerConfig()?.admin?.branding?.showBuilder;
  return typeof showBuilder === "boolean"
    ? showBuilder
    : process.env.NODE_ENV !== "production";
}

/**
 * The refusal for a builder-only operation while the builder is disabled.
 *
 * Distinct from a permission failure: the caller may well be a super-admin.
 * The environment, not the user, is what forbids this — so it carries its own
 * code and says which switch turns it back on.
 *
 * @param operation - Operation name for the log, e.g. "create-collection".
 */
export function builderDisabledError(operation: string): NextlyError {
  return new NextlyError({
    code: "BUILDER_DISABLED",
    publicMessage:
      "The schema builder is disabled in this environment. Define schema in code, or set admin.branding.showBuilder to true to enable it here.",
    logContext: { operation, nodeEnv: process.env.NODE_ENV },
  });
}

/**
 * Throw when a builder-only schema mutation is attempted while disabled.
 *
 * For handlers wrapped in `withErrorHandler`, which turns a NextlyError into
 * the canonical response. Callers outside that wrapper must not use this —
 * a throw there escapes as a 500 — and should return a response built from
 * {@link builderDisabledError} instead.
 */
export function requireBuilderEnabled(operation: string): void {
  if (isBuilderEnabled()) return;
  throw builderDisabledError(operation);
}

/**
 * Dispatcher methods the schema builder owns, by service.
 *
 * These read and write the schema itself. Entry CRUD is deliberately absent:
 * a deployed site still manages its content. The previews are included because
 * they exist only to feed the builder's diff UI — they are dry runs, but there
 * is no reason to answer them where the builder cannot run.
 */
const BUILDER_METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "collections",
    new Set([
      "createCollection",
      "updateCollection",
      "deleteCollection",
      "previewSchemaChanges",
      "applySchemaChanges",
    ]),
  ],
  [
    "singles",
    new Set([
      "createSingle",
      "updateSingleSchema",
      "deleteSingle",
      "previewSingleSchemaChanges",
      "applySingleSchemaChanges",
    ]),
  ],
  [
    "components",
    new Set([
      "createComponent",
      "updateComponent",
      "deleteComponent",
      "previewComponentSchemaChanges",
      "applyComponentSchemaChanges",
    ]),
  ],
]);

/**
 * Whether a resolved dispatcher route belongs to the schema builder.
 *
 * A Map rather than an object literal: the lookup key is a routing string, and
 * an object would resolve inherited names like "constructor" to a function,
 * making the membership test throw instead of answering false.
 */
export function isBuilderRoute(service: string, method: string): boolean {
  return BUILDER_METHODS.get(service)?.has(method) ?? false;
}

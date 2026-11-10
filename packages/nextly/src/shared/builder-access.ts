/**
 * Availability of the visual schema builder in the admin and through the admin API.
 *
 * The builder issues DDL (create/alter/drop) against the live database from a browser. It is off
 * in production whatever the configuration says (`builder-refusal.ts` owns that rule and the
 * refusal), and outside production `admin.branding.showBuilder: false` turns it off. The
 * schema-mutation endpoints refuse wherever it is off — hiding the navigation alone would leave
 * them reachable by URL — and the admin is told the same answer.
 *
 * Reading entities stays open in every environment: production still lists collections and
 * singles to manage their entries, and entry writes are never refused here.
 *
 * Kept apart from `builder-refusal.ts` because this one reads the stored configuration through
 * the route handler, and the code-side schema saves (the Direct API, a plugin's services, the
 * start) must not import the route handler.
 */

import type { NextlyError } from "../errors/nextly-error";
import { getHandlerConfig } from "../route-handler/auth-handler";

import {
  builderDisabledError,
  type BuilderOffReason,
  isProductionRuntime,
} from "./builder-refusal";

/** Why the builder is off where this runs, or `null` while it is on. */
function builderOffReason(): BuilderOffReason | null {
  if (isProductionRuntime()) return "production";
  // Only an explicit `false` turns it off outside production; anything else leaves it on.
  return getHandlerConfig()?.admin?.branding?.showBuilder === false
    ? "turned-off"
    : null;
}

/**
 * Whether the schema builder (and its mutation endpoints) is available.
 *
 * Off in production, whatever `admin.branding.showBuilder` says. Elsewhere on, unless
 * `showBuilder` is `false`.
 */
export function isBuilderEnabled(): boolean {
  return builderOffReason() === null;
}

/**
 * The refusal owed for a builder operation here, or `null` while the builder is on.
 *
 * For callers that answer with a response rather than a throw (the REST gate runs outside the
 * dispatcher's NextlyError-to-response mapping).
 */
export function builderRefusal(operation: string): NextlyError | null {
  const reason = builderOffReason();
  return reason === null ? null : builderDisabledError(operation, reason);
}

/**
 * Throw when a builder-only schema mutation is attempted while disabled.
 *
 * For handlers wrapped in `withErrorHandler`, which turns a NextlyError into
 * the canonical response. Callers outside that wrapper must not use this —
 * a throw there escapes as a 500 — and should return the response built from
 * {@link builderRefusal} instead.
 */
export function requireBuilderEnabled(operation: string): void {
  const refusal = builderRefusal(operation);
  if (refusal) throw refusal;
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
      // The delete dialog's dry run, for the reason the previews are here.
      "previewCollectionDelete",
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
    "field-groups",
    new Set([
      "createComponent",
      "updateComponent",
      "deleteComponent",
      "previewComponentSchemaChanges",
      "applyComponentSchemaChanges",
      // Rewrites the stored definition, so it is builder surface exactly as the apply is: where
      // the builder cannot run, the repair it feeds cannot either — and leaving it out would let
      // a direct call rewrite schema on a deployment whose builder is disabled.
      "reconcileComponent",
      // Its preview belongs with it for the reason the other previews do: it exists to feed the
      // builder's own repair dialog, and answering it where the repair cannot run would describe a
      // change the caller has no way to make.
      "previewComponentReconcile",
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

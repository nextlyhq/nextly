/**
 * The shapes a field-group reconcile reports, for whoever renders them.
 *
 * ## Why this is a public entry point
 *
 * The reconcile surface has to show a repair by IDENTITY — which field lost its column, which
 * column was adopted under a guessed type, which drift refused the whole operation — because a
 * count cannot tell an operator whether the thing they care about is in the list. That means the
 * admin renders these structures rather than a message, and rendering them needs the types.
 *
 * Published as its own subpath rather than reached for through the package root: the root pulls in
 * the runtime, and the only thing a renderer needs here is the vocabulary. Everything below is a
 * TYPE, so this entry contributes no runtime code to a browser bundle at all.
 *
 * Re-exported rather than re-declared. A second copy of these shapes in the admin would agree with
 * the service on the day it was written and drift silently afterwards, and the drift would surface
 * as a repair summary quietly missing a category — which is the one failure this surface exists to
 * prevent.
 *
 * @module field-group-reconcile
 */

export type {
  ReconcileFieldGroupPreview,
  ReconcileFieldGroupResult,
} from "./domains/field-groups/services/field-group-reconcile-service";

export type {
  ReconcileAdoption,
  ReconcileBlocker,
  ReconcileRemoval,
  ReconcileRepair,
  ReconcileTable,
} from "./domains/field-groups/services/reconcile-field-group-plan";

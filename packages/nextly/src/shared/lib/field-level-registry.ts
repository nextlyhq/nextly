/**
 * Field-level function registry: the bridge that makes code-first
 * field `validate` / `access` / `hooks` actually execute.
 *
 * The DB-backed collection registry serializes field definitions, which
 * drops functions — so the write/read services can never find them on the
 * field defs they load. This registry captures the function-bearing field
 * configs from the LIVE `defineConfig` object during service registration
 * and hands them back to the services by collection slug.
 *
 * globalThis-backed so dev-mode HMR re-execution reuses one store (the
 * same pattern as init/schema-snapshot-cache); re-registration replaces a
 * slug's entry wholesale, so a config reload never leaves stale functions.
 *
 * Semantics implemented here (matching the types' documented contracts):
 * - `access.create/update`: a `false` result strips the field from the
 *   write silently (the caller keeps working with the fields they may
 *   touch); `overrideAccess` bypasses.
 * - `access.read`: a `false` result strips the field from serialized
 *   responses.
 * - `hooks.beforeValidate` / `hooks.beforeChange`: transform the incoming
 *   field value (return value replaces it; `undefined` keeps it).
 * - `hooks.afterChange` / `hooks.afterRead`: observe/transform the stored
 *   value on the way out.
 *
 * @module shared/lib/field-level-registry
 */

import { NextlyError } from "../../errors/nextly-error";
import { normalizeHookError } from "../../hooks/normalize-hook-error";
import { singleHookNamespace } from "../../hooks/register-single-hooks";
import { recordSideEffectWarning } from "../../hooks/side-effect-warnings";
import type { FieldHookHandler } from "../../hooks/types";
import {
  listEffectivePermissions,
  listRoleSlugsForUser,
} from "../../services/lib/permissions";

import { detachData } from "./detach";
import type { ValidatableField } from "./entry-validation";

type MaybePromise<T> = T | Promise<T>;

interface FieldRequestContext {
  user?: Record<string, unknown>;
}

type FieldAccessFn = (args: {
  req: FieldRequestContext;
  id?: string;
  data?: Record<string, unknown>;
  permissions: string[];
  roles: string[];
}) => MaybePromise<boolean>;

/**
 * The caller's grants, in the SAME spelling collection-level access uses.
 *
 * A field rule and a collection rule are written by the same person, minutes
 * apart, and a permission that reads `pages:create` in one and something else
 * in the other is a rule that silently denies. `listEffectivePermissions` is
 * the single source for the string, so this carries what it returns rather
 * than re-deriving it.
 */
interface CallerGrants {
  permissions: string[];
  roles: string[];
}

/**
 * Resolve the caller's grants once, on the first rule that actually runs.
 *
 * Field access is evaluated on every authenticated write and read, and most
 * entities declare no rule at all — so resolving eagerly would put a role and
 * permission lookup on paths that never ask a question. Memoizing the PROMISE
 * rather than the value also collapses the concurrent case: the rules at one
 * level run in sequence but a nested container recurses first, and two levels
 * asking at once must not become two lookups.
 */
function grantsResolver(
  userId: string | undefined
): () => Promise<CallerGrants> {
  let pending: Promise<CallerGrants> | undefined;
  return () => {
    if (pending) return pending;
    if (!userId) {
      pending = Promise.resolve({ permissions: [], roles: [] });
      return pending;
    }
    pending = Promise.all([
      listEffectivePermissions(userId),
      listRoleSlugsForUser(userId),
    ])
      .then(([permissions, roles]) => ({ permissions, roles }))
      // Fail CLOSED on a lookup error: an empty grant set denies every rule
      // that asks for a permission, which is the safe direction. Throwing here
      // would instead be caught by the per-rule guard below and read as a
      // denial anyway, but only for the rule that happened to ask first.
      .catch(() => ({ permissions: [], roles: [] }));
    return pending;
  };
}

// The registry stores exactly what a field hook is declared as, so the shape
// lives in one place rather than being restated here.
type FieldHookFn = FieldHookHandler;

export interface FieldFunctions {
  validate?: ValidatableField["validate"];
  access?: {
    create?: FieldAccessFn;
    read?: FieldAccessFn;
    update?: FieldAccessFn;
  };
  hooks?: {
    beforeValidate?: FieldHookFn[];
    beforeChange?: FieldHookFn[];
    afterChange?: FieldHookFn[];
    afterRead?: FieldHookFn[];
  };
  /** Nested function-bearing fields (repeater/group containers). */
  fields?: Record<string, FieldFunctions>;
}

type EntityKind = "collection" | "single";
type Store = Map<string, Record<string, FieldFunctions>>;

const GLOBAL_KEY = "__nextlyFieldFunctionRegistry";

function store(): Store {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY] as Store;
}

function key(kind: EntityKind, slug: string): string {
  return `${kind}:${slug}`;
}

/** Extract the function-bearing subset of one field config. */
function extractFieldFunctions(
  field: Record<string, unknown>
): FieldFunctions | undefined {
  const out: FieldFunctions = {};
  let hasAny = false;

  if (typeof field.validate === "function") {
    out.validate = field.validate as FieldFunctions["validate"];
    hasAny = true;
  }
  const access = field.access as FieldFunctions["access"] | undefined;
  if (
    access &&
    (typeof access.create === "function" ||
      typeof access.read === "function" ||
      typeof access.update === "function")
  ) {
    out.access = access;
    hasAny = true;
  }
  const hooks = field.hooks as FieldFunctions["hooks"] | undefined;
  if (
    hooks &&
    (hooks.beforeValidate?.length ||
      hooks.beforeChange?.length ||
      hooks.afterChange?.length ||
      hooks.afterRead?.length)
  ) {
    out.hooks = hooks;
    hasAny = true;
  }

  const nested = field.fields;
  if (Array.isArray(nested)) {
    const nestedMap = collectFieldFunctions(nested);
    if (nestedMap) {
      out.fields = nestedMap;
      hasAny = true;
    }
  }

  return hasAny ? out : undefined;
}

function collectFieldFunctions(
  fields: unknown[]
): Record<string, FieldFunctions> | undefined {
  const map: Record<string, FieldFunctions> = {};
  let hasAny = false;
  for (const raw of fields) {
    if (raw === null || typeof raw !== "object") continue;
    const field = raw as Record<string, unknown>;
    if (typeof field.name !== "string" || !field.name) continue;
    const fns = extractFieldFunctions(field);
    if (fns) {
      map[field.name] = fns;
      hasAny = true;
    }
  }
  return hasAny ? map : undefined;
}

/**
 * Capture function-bearing field configs for one entity from the live
 * config object. Replaces any previous registration for the slug.
 */
export function registerFieldFunctions(
  kind: EntityKind,
  slug: string,
  fields: unknown[]
): void {
  const map = collectFieldFunctions(fields);
  if (map) {
    store().set(key(kind, slug), map);
  } else {
    store().delete(key(kind, slug));
  }
}

export function getFieldFunctions(
  kind: EntityKind,
  slug: string
): Record<string, FieldFunctions> | undefined {
  return store().get(key(kind, slug));
}

/** Test seam. */
export function clearFieldFunctions(): void {
  store().clear();
}

/**
 * Attach registered custom `validate` functions onto the (serialized)
 * field definitions so the entry validator can run them. Returns the
 * original array when the entity registered no functions.
 */
export function attachFieldValidators(
  kind: EntityKind,
  slug: string,
  fields: ValidatableField[]
): ValidatableField[] {
  const fns = getFieldFunctions(kind, slug);
  if (!fns) return fields;
  return attachValidators(fields, fns);
}

function attachValidators(
  fields: ValidatableField[],
  fns: Record<string, FieldFunctions>
): ValidatableField[] {
  return fields.map(field => {
    const entry = field.name ? fns[field.name] : undefined;
    if (!entry) return field;
    const next: ValidatableField = { ...field };
    if (entry.validate) next.validate = entry.validate;
    if (entry.fields && field.fields) {
      next.fields = attachValidators(field.fields, entry.fields);
    }
    return next;
  });
}

/**
 * The container rows a nested field set applies to: a `group` value is one
 * object, a `repeater` value is its array of row objects. Non-object rows
 * are skipped (they carry no nested fields to process).
 */
function nestedRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> =>
        row !== null && typeof row === "object" && !Array.isArray(row)
    );
  }
  if (value !== null && typeof value === "object") {
    return [value as Record<string, unknown>];
  }
  return [];
}

/**
 * Open a container value for in-place editing, parsing a JSON string first.
 *
 * SQLite stores `group` / `repeater` values as JSON strings, so a caller that
 * hands over a row straight from the database has containers that
 * {@link nestedRows} cannot descend — the nested fields inside would keep
 * whatever the rules should have removed. `serialize()` writes the (mutated)
 * container back in the shape it arrived in, so a string column stays a string.
 * Returns null when there is nothing to descend into.
 */
function openNestedContainer(
  value: unknown
): { rows: Record<string, unknown>[]; serialize: () => unknown } | null {
  if (typeof value !== "string") {
    const rows = nestedRows(value);
    return rows.length > 0 ? { rows, serialize: () => value } : null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const rows = nestedRows(parsed);
  if (rows.length === 0) return null;
  return { rows, serialize: () => JSON.stringify(parsed) };
}

/**
 * Whether any field at this level has an access callback for the operation.
 *
 * Decides whether a snapshot is worth taking at all: a level with no callbacks
 * never shows its data to app code, so copying it would be pure cost on every
 * row of every list read.
 */
function levelHasAccessCallback(
  fns: Record<string, FieldFunctions>,
  operation: "create" | "update" | "read"
): boolean {
  for (const entry of Object.values(fns)) {
    if (typeof entry.access?.[operation] === "function") return true;
  }
  return false;
}

/**
 * Recursive worker for write access. Every rule at one level is evaluated
 * against the SAME immutable snapshot of that level's data, so a rule that
 * reads a sibling field's value can't flip from deny to allow purely
 * because an earlier-registered field was already deleted (registration
 * order must not change the outcome). Denied fields are removed only after
 * all rules at the level have run. Nested containers recurse first.
 */
async function applyWriteAccessRec(
  data: Record<string, unknown>,
  fns: Record<string, FieldFunctions>,
  operation: "create" | "update",
  ctx: {
    user?: Record<string, unknown>;
    id?: string;
    grants: () => Promise<CallerGrants>;
  }
): Promise<void> {
  // Taken BEFORE the recursion below, which rewrites nested containers in
  // place as it redacts them: a rule at this level that reads into a nested
  // value must see what the level held when it was entered, not what an
  // earlier-registered field's recursion left behind. Skipped entirely when no
  // rule at this level will run.
  const snapshot = levelHasAccessCallback(fns, operation)
    ? detachData(data)
    : undefined;
  const denied: string[] = [];
  for (const [name, entry] of Object.entries(fns)) {
    if (!(name in data)) continue;
    if (entry.fields) {
      for (const row of nestedRows(data[name])) {
        await applyWriteAccessRec(row, entry.fields, operation, ctx);
      }
    }
    const fn = entry.access?.[operation];
    if (!fn) continue;
    let allowed = false;
    try {
      const { permissions, roles } = await ctx.grants();
      allowed = await fn({
        req: { user: ctx.user },
        id: ctx.id,
        data: snapshot,
        permissions,
        roles,
      });
    } catch {
      // Fail-secure: an access rule that throws denies the field.
      allowed = false;
    }
    if (!allowed) denied.push(name);
  }
  for (const name of denied) delete data[name];
}

/**
 * Enforce field-level write access: fields the caller may not create or
 * update are stripped from the payload (silent, Payload-parity), never an
 * error. Applies at every depth (group/repeater nesting). `overrideAccess`
 * (trusted server context) bypasses entirely.
 */
export async function applyFieldWriteAccess(opts: {
  kind: EntityKind;
  slug: string;
  data: Record<string, unknown>;
  operation: "create" | "update";
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
  id?: string;
}): Promise<void> {
  // Bypass for a caller that has SAID it is trusted, and only that. The read
  // side gates on the same single condition, and the two must agree: a rule
  // that strips a field from an authenticated writer but not from an
  // unauthenticated one would make less authentication buy more authority.
  //
  // Absence of a user is not trust. `collection-access-service` does read
  // `overrideAccess || !user`, but only where it resolves a stored OWNER
  // predicate — with nobody to compare against, that predicate is unanswerable
  // rather than failing. A field rule is a different question: it asks whether
  // THIS writer may set this field, and "nobody" is a perfectly good answer.
  // Its main gate uses `overrideAccess` alone, which is the one this matches.
  //
  // An internal writer that needs to set a protected field says so with
  // `overrideAccess: true`; that is a deliberate line in the caller rather
  // than a property of having no session.
  if (opts.overrideAccess) return;
  const fns = getFieldFunctions(opts.kind, opts.slug);
  if (!fns) return;
  await applyWriteAccessRec(opts.data, fns, opts.operation, {
    user: opts.user,
    id: opts.id,
    // An anonymous writer resolves to NO grants — `grantsResolver(undefined)`
    // answers `{ permissions: [], roles: [] }` — so a rule written as
    // `({ permissions }) => permissions.includes(...)` refuses it, which is
    // the correct answer rather than an accident of the shape.
    grants: grantsResolver(
      typeof opts.user?.id === "string" ? opts.user.id : undefined
    ),
  });
}

/**
 * The values each read-access pass removed from a row, keyed by the row OBJECT,
 * so a later pass over the same row can restore them as EVIDENCE before it
 * re-judges the row.
 *
 * The nested-read pipeline applies access to a related row BEFORE its parent's
 * hooks (so a hook cannot read a denied child field to copy it), then AGAIN
 * after all hooks (a hook may have written a denied field back, mutated a row in
 * place, or added, replaced, or reordered rows). The second pass MUST re-run the
 * rules against the post-hook content — a cached verdict cannot be trusted once a
 * hook may have changed what the rule reads. Re-running alone would flip a
 * verdict, though: the first pass already removed the denied values a rule reads
 * as evidence, so a field kept only while such a value was present would be
 * wrongly dropped. Restoring each row's removed values first (unless a hook has
 * since set them) gives the rules the same evidence the first pass — and a direct
 * read — judged against, while the current values of everything a hook touched
 * are seen and re-judged.
 *
 * A restored value is EVIDENCE only, never response data: it is one the caller
 * was denied and the post-hook row did not itself supply, so it is removed again
 * once every snapshot that needed it has been taken. Otherwise a hook that flips
 * a field's CONDITION from deny to allow (say, a sibling `tier`) without
 * reintroducing the value would resurrect the value the first pass removed.
 *
 * The restore runs over the WHOLE subtree before any level's snapshot is taken,
 * because the evidence a rule reads is not always a sibling: an outer field's
 * rule can depend on a value inside a nested group or repeater the first pass
 * already redacted. Snapshotting a level before descending to restore its nested
 * rows would judge that outer rule against a stripped subtree and drop it, unlike
 * a direct read which judges once with the subtree intact.
 *
 * Keyed by the row object, never by an `id`: two rows may carry the same `id`,
 * and a replacement row is a genuinely new object that must be judged on its own
 * content. Row objects survive between the passes because the nested walk decodes
 * container values to arrays before hooks run.
 */
export type ReadAccessRedactions = WeakMap<
  Record<string, unknown>,
  Record<string, unknown>
>;

/** One value a pass put back purely as evidence: the row it was written onto and
 *  the key, so it can be removed again once the snapshots that needed it are
 *  taken. */
interface RestoredEvidence {
  row: Record<string, unknown>;
  name: string;
}

/**
 * The field names a pass RESTORED onto each row purely as evidence, keyed by the
 * row object. The recorder consults it to tell a value the post-hook row
 * genuinely supplies — which clears its stale redaction — from one present only
 * because this pass restored it, which must be remembered as still-removed.
 */
type RestoredByRow = WeakMap<Record<string, unknown>, Set<string>>;

/**
 * Restore, throughout the subtree rooted at `entry`, the values a prior pass
 * removed from each row — unless a hook has since set the key, so a hook's own
 * value stands. Runs once before any snapshot is taken, so a rule at any level is
 * judged against the evidence a single direct read would see. Every value it puts
 * back is recorded in `restored`, because it is EVIDENCE, not response data: the
 * caller was denied it and the post-hook row did not supply it, so it must be
 * removed again once the snapshots are taken (see {@link applyFieldReadAccess}).
 *
 * The restore has to span the whole subtree, not just the current row: an outer
 * field's rule can read a value that lives in a nested group or repeater a prior
 * pass already redacted. Restoring per row on the way down would take the outer
 * level's snapshot before descending to restore that nested value, and the rule
 * would judge against the stripped subtree and wrongly drop the outer field.
 */
function restoreReadAccessEvidence(
  entry: Record<string, unknown>,
  fns: Record<string, FieldFunctions>,
  redactions: ReadAccessRedactions,
  restored: RestoredEvidence[],
  restoredByRow: RestoredByRow
): void {
  const priorlyRemoved = redactions.get(entry);
  if (priorlyRemoved) {
    for (const [name, value] of Object.entries(priorlyRemoved)) {
      if (!(name in entry)) {
        entry[name] = value;
        restored.push({ row: entry, name });
        // Recorded so the judge can distinguish this evidence-only value, which
        // stays removed, from one the post-hook row genuinely supplied.
        let names = restoredByRow.get(entry);
        if (!names) {
          names = new Set();
          restoredByRow.set(entry, names);
        }
        names.add(name);
      }
    }
  }
  for (const [name, fieldFns] of Object.entries(fns)) {
    if (!fieldFns.fields || !(name in entry)) continue;
    const container = openNestedContainer(entry[name]);
    if (!container) continue;
    for (const row of container.rows) {
      restoreReadAccessEvidence(
        row,
        fieldFns.fields,
        redactions,
        restored,
        restoredByRow
      );
    }
    entry[name] = container.serialize();
  }
}

/** Recursive worker for read access — same snapshot + recurse contract. Prior
 *  passes' removed values are restored across the whole subtree by
 *  {@link restoreReadAccessEvidence} before this runs, so the snapshot reflects
 *  the content a single direct read would judge; the rules always run against the
 *  current content, and what this pass removes is recorded for the next. */
async function applyReadAccessRec(
  entry: Record<string, unknown>,
  fns: Record<string, FieldFunctions>,
  ctx: {
    user?: Record<string, unknown>;
    id?: string;
    grants: () => Promise<CallerGrants>;
  },
  redactions: ReadAccessRedactions,
  restoredByRow: RestoredByRow
): Promise<void> {
  // Taken BEFORE the recursion below replaces nested containers with their
  // redacted serialization: a parent-level rule reading a protected nested
  // value would otherwise find it already removed, and the outcome would turn
  // on field registration order.
  const snapshot = levelHasAccessCallback(fns, "read")
    ? detachData(entry)
    : undefined;
  const denied: string[] = [];
  for (const [name, fieldFns] of Object.entries(fns)) {
    if (!(name in entry)) continue;
    if (fieldFns.fields) {
      const container = openNestedContainer(entry[name]);
      if (container) {
        for (const row of container.rows) {
          await applyReadAccessRec(
            row,
            fieldFns.fields,
            ctx,
            redactions,
            restoredByRow
          );
        }
        entry[name] = container.serialize();
      }
    }
    const fn = fieldFns.access?.read;
    if (!fn) continue;
    let allowed = false;
    try {
      const { permissions, roles } = await ctx.grants();
      allowed = await fn({
        req: { user: ctx.user },
        id: ctx.id,
        data: snapshot,
        permissions,
        roles,
      });
    } catch {
      // Fail-secure: an access rule that throws denies the field.
      allowed = false;
    }
    if (!allowed) denied.push(name);
  }
  // Record what stays removed for the next pass to restore as evidence. A prior
  // pass's removed value is carried forward only while the row still lacks the
  // key, or holds it solely because THIS pass restored it as evidence (about to
  // be stripped again). A field the post-hook row genuinely supplies and that was
  // allowed clears its stale evidence, so a later rule keyed on the old value is
  // not judged against a value the row no longer carries.
  const priorlyRemoved = redactions.get(entry);
  const restoredHere = restoredByRow.get(entry);
  const removed: Record<string, unknown> = {};
  if (priorlyRemoved) {
    for (const [name, value] of Object.entries(priorlyRemoved)) {
      if (!(name in entry) || restoredHere?.has(name)) {
        removed[name] = value;
      }
    }
  }
  for (const name of denied) {
    removed[name] = entry[name];
    delete entry[name];
  }
  if (Object.keys(removed).length > 0) {
    redactions.set(entry, removed);
  } else {
    // Nothing stays removed: drop any stale entry so a later pass does not
    // restore a value this row now legitimately carries or no longer hides.
    redactions.delete(entry);
  }
}

/**
 * Enforce field-level read access on a serialized entry: fields whose
 * `access.read` denies are removed from the response, at every depth.
 *
 * Pass a shared {@link ReadAccessRedactions} to run access more than once over
 * rows a hook may have mutated in between (the nested-read pipeline's
 * before-hooks and after-hooks passes): each pass restores the values a prior
 * pass removed from a row as evidence, then re-judges the row against its current
 * content — so a denied field a hook reintroduced or a row it changed is caught,
 * while a field kept only because of a now-removed sibling keeps its verdict.
 */
export async function applyFieldReadAccess(
  opts: {
    kind: EntityKind;
    slug: string;
    entry: Record<string, unknown>;
    user?: Record<string, unknown>;
    overrideAccess?: boolean;
  },
  redactions?: ReadAccessRedactions
): Promise<void> {
  if (opts.overrideAccess) return;
  const fns = getFieldFunctions(opts.kind, opts.slug);
  if (!fns) return;
  const store = redactions ?? new WeakMap();
  // Restore the whole subtree's prior-pass evidence before any level's snapshot,
  // so an outer rule reading a value nested in a group or repeater is judged
  // against the same content a single direct read would (a no-op on the first
  // pass, whose store is empty). The judge below re-removes what stays denied.
  // The restored keys are tracked so the judge can tell them from values the row
  // genuinely supplies when it decides what stays recorded as removed.
  const restored: RestoredEvidence[] = [];
  const restoredByRow: RestoredByRow = new WeakMap();
  restoreReadAccessEvidence(opts.entry, fns, store, restored, restoredByRow);
  await applyReadAccessRec(
    opts.entry,
    fns,
    {
      user: opts.user,
      id: typeof opts.entry.id === "string" ? opts.entry.id : undefined,
      // An unauthenticated read still runs the rules — this path, unlike the
      // write one, does not bail without a user — so the resolver is handed the
      // same absent id and answers with no grants rather than not being called.
      grants: grantsResolver(
        typeof opts.user?.id === "string" ? opts.user.id : undefined
      ),
    },
    store,
    restoredByRow
  );
  // A restored value existed only to feed the snapshots above. The caller was
  // denied it and the post-hook row did not supply it, so it must not appear in
  // the response even when the current pass judged it allowed — a hook that
  // flipped the field's CONDITION from deny to allow (say, a sibling `tier`)
  // without reintroducing the value must not resurrect the value the first pass
  // removed. Removed after every snapshot is taken, so re-judging still saw it.
  for (const { row, name } of restored) delete row[name];
}

/** Recursive worker for hooks. Transforms values in registration order. */
async function runFieldHooksRec(
  data: Record<string, unknown>,
  fns: Record<string, FieldFunctions>,
  phase: "beforeValidate" | "beforeChange" | "afterChange" | "afterRead",
  ctx: {
    slug: string;
    kind: EntityKind;
    operation: "create" | "read" | "update" | "delete";
    user?: Record<string, unknown>;
  }
): Promise<void> {
  for (const [name, entry] of Object.entries(fns)) {
    if (!(name in data)) continue;
    if (entry.fields) {
      for (const row of nestedRows(data[name])) {
        await runFieldHooksRec(row, entry.fields, phase, ctx);
      }
    }
    const handlers = entry.hooks?.[phase];
    if (!handlers?.length) continue;
    let value = data[name];
    for (const handler of handlers) {
      // `afterChange` runs once the row is durable, so a handler throwing
      // there cannot un-save it. Letting it propagate failed the whole write
      // -- and in a bulk operation classified a committed row as failed,
      // which is the retry-duplicates-the-write hazard the collection-level
      // phases already avoid. Field-level handlers get the same treatment:
      // normalize, report, and keep going, so one broken handler does not
      // silently skip the ones after it.
      //
      // Every other phase runs BEFORE the write and keeps failing fast: there
      // the throw is the handler rejecting the input, and the operation has
      // not happened yet.
      if (phase === "afterChange") {
        try {
          const result = await handler({
            collection: ctx.slug,
            operation: ctx.operation,
            fieldName: name,
            value,
            data,
            user: ctx.user,
          });
          if (result !== undefined) value = result;
        } catch (error) {
          // The registry has no `afterChange` phase: it maps onto
          // `afterCreate` / `afterUpdate`, and the operation says which. A
          // warning naming a phase the registry does not have would not match
          // what a collection-level handler on the same write reports.
          const committedPhase =
            ctx.operation === "create" ? "afterCreate" : "afterUpdate";
          // The key the hook registry stores a Single under, so a warning
          // from a field-level handler and one from an entity-level handler
          // on the same write name the same entity. A bare slug would also
          // collide with a collection sharing it.
          const registryKey =
            ctx.kind === "single" ? singleHookNamespace(ctx.slug) : ctx.slug;
          const normalized = normalizeHookError(
            error,
            committedPhase,
            registryKey,
            { fieldName: name }
          );
          console.error(
            `Field hook "afterChange" failed for "${registryKey}.${name}" after the write committed:`,
            normalized
          );
          recordSideEffectWarning({
            phase: committedPhase,
            collection: registryKey,
            error: NextlyError.is(normalized)
              ? normalized
              : NextlyError.internal({
                  logContext: { collection: registryKey, fieldName: name },
                }),
          });
        }
        continue;
      }
      const result = await handler({
        collection: ctx.slug,
        operation: ctx.operation,
        fieldName: name,
        value,
        data,
        user: ctx.user,
      });
      if (result !== undefined) value = result;
    }
    data[name] = value;
  }
}

/**
 * Run one field-hook phase over the provided values, at every depth. A
 * hook's non-undefined return replaces the field value; hooks run in
 * registration order.
 */
export async function runFieldHooks(opts: {
  kind: EntityKind;
  slug: string;
  phase: "beforeValidate" | "beforeChange" | "afterChange" | "afterRead";
  data: Record<string, unknown>;
  operation: "create" | "read" | "update" | "delete";
  user?: Record<string, unknown>;
}): Promise<void> {
  const fns = getFieldFunctions(opts.kind, opts.slug);
  if (!fns) return;
  await runFieldHooksRec(opts.data, fns, opts.phase, {
    slug: opts.slug,
    kind: opts.kind,
    operation: opts.operation,
    user: opts.user,
  });
}

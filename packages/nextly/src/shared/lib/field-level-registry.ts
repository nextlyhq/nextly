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
}) => MaybePromise<boolean>;

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
  ctx: { user?: Record<string, unknown>; id?: string }
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
      allowed = await fn({
        req: { user: ctx.user },
        id: ctx.id,
        data: snapshot,
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
  // Bypass for trusted contexts, matching the collection access service's
  // `overrideAccess || !user` rule: an explicit override or a system write
  // with no user context is trusted, so per-field rules don't run and can't
  // strip fields an internal writer intended to set. Authenticated writes
  // (user present, no override) are enforced.
  if (opts.overrideAccess || !opts.user) return;
  const fns = getFieldFunctions(opts.kind, opts.slug);
  if (!fns) return;
  await applyWriteAccessRec(opts.data, fns, opts.operation, {
    user: opts.user,
    id: opts.id,
  });
}

/**
 * What a read-access pass removed from one row, at every depth, so a later
 * cleanup can remove the SAME fields a hook reintroduced without re-running the
 * policy. Re-running it is unsafe: a rule reads the row as `data`, so evaluating
 * it a second time against the already-stripped row can flip a decision (a field
 * allowed only while a now-denied sibling is present would be wrongly removed),
 * and an async rule would issue its queries twice.
 */
export interface FieldRedactionPlan {
  /** Field names denied at this level. */
  denied: string[];
  /** Per container field, the plan for each of its rows, by index. */
  nested: Array<{ name: string; rows: FieldRedactionPlan[] }>;
}

/** Recursive worker for read access — same snapshot + recurse contract.
 *  Returns the redaction it performed so it can be replayed (see
 *  {@link replayFieldRedaction}). */
async function applyReadAccessRec(
  entry: Record<string, unknown>,
  fns: Record<string, FieldFunctions>,
  ctx: { user?: Record<string, unknown>; id?: string }
): Promise<FieldRedactionPlan> {
  // Taken BEFORE the recursion below replaces nested containers with their
  // redacted serialization: a parent-level rule reading a protected nested
  // value would otherwise find it already removed, and the outcome would turn
  // on field registration order.
  const snapshot = levelHasAccessCallback(fns, "read")
    ? detachData(entry)
    : undefined;
  const denied: string[] = [];
  const nested: FieldRedactionPlan["nested"] = [];
  for (const [name, fieldFns] of Object.entries(fns)) {
    if (!(name in entry)) continue;
    if (fieldFns.fields) {
      const container = openNestedContainer(entry[name]);
      if (container) {
        const rows: FieldRedactionPlan[] = [];
        for (const row of container.rows) {
          rows.push(await applyReadAccessRec(row, fieldFns.fields, ctx));
        }
        entry[name] = container.serialize();
        nested.push({ name, rows });
      }
    }
    const fn = fieldFns.access?.read;
    if (!fn) continue;
    let allowed = false;
    try {
      allowed = await fn({
        req: { user: ctx.user },
        id: ctx.id,
        data: snapshot,
      });
    } catch {
      allowed = false;
    }
    if (!allowed) denied.push(name);
  }
  for (const name of denied) delete entry[name];
  return { denied, nested };
}

/**
 * Re-remove the fields a prior {@link applyFieldReadAccess} pass denied on a
 * row, WITHOUT re-running the policy, so a denied value a later hook wrote back
 * onto the row is stripped again. The policy already ran once (that produced the
 * plan); replaying its decisions avoids both re-deciding against mutated data
 * and re-issuing async rule queries.
 */
export function replayFieldRedaction(
  entry: Record<string, unknown>,
  plan: FieldRedactionPlan
): void {
  for (const { name, rows } of plan.nested) {
    if (!(name in entry)) continue;
    const container = openNestedContainer(entry[name]);
    if (container) {
      container.rows.forEach((row, index) => {
        const rowPlan = rows[index];
        if (rowPlan) replayFieldRedaction(row, rowPlan);
      });
      entry[name] = container.serialize();
    }
  }
  for (const name of plan.denied) delete entry[name];
}

/**
 * Enforce field-level read access on a serialized entry: fields whose
 * `access.read` denies are removed from the response, at every depth. Returns
 * the redaction it performed (undefined for a trusted/override read or an
 * unregistered entity), which {@link replayFieldRedaction} can re-apply after
 * later hooks run.
 */
export async function applyFieldReadAccess(opts: {
  kind: EntityKind;
  slug: string;
  entry: Record<string, unknown>;
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
}): Promise<FieldRedactionPlan | undefined> {
  if (opts.overrideAccess) return undefined;
  const fns = getFieldFunctions(opts.kind, opts.slug);
  if (!fns) return undefined;
  return applyReadAccessRec(opts.entry, fns, {
    user: opts.user,
    id: typeof opts.entry.id === "string" ? opts.entry.id : undefined,
  });
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

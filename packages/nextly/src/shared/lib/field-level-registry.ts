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

type FieldHookFn = (context: {
  collection: string;
  operation: "create" | "read" | "update" | "delete";
  fieldName: string;
  value: unknown;
  data: Record<string, unknown>;
  user?: Record<string, unknown>;
}) => MaybePromise<unknown>;

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
  const snapshot = { ...data };
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

/** Recursive worker for read access — same snapshot + recurse contract. */
async function applyReadAccessRec(
  entry: Record<string, unknown>,
  fns: Record<string, FieldFunctions>,
  ctx: { user?: Record<string, unknown>; id?: string }
): Promise<void> {
  const snapshot = { ...entry };
  const denied: string[] = [];
  for (const [name, fieldFns] of Object.entries(fns)) {
    if (!(name in entry)) continue;
    if (fieldFns.fields) {
      for (const row of nestedRows(entry[name])) {
        await applyReadAccessRec(row, fieldFns.fields, ctx);
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
}

/**
 * Enforce field-level read access on a serialized entry: fields whose
 * `access.read` denies are removed from the response, at every depth.
 */
export async function applyFieldReadAccess(opts: {
  kind: EntityKind;
  slug: string;
  entry: Record<string, unknown>;
  user?: Record<string, unknown>;
  overrideAccess?: boolean;
}): Promise<void> {
  if (opts.overrideAccess) return;
  const fns = getFieldFunctions(opts.kind, opts.slug);
  if (!fns) return;
  await applyReadAccessRec(opts.entry, fns, {
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
    operation: opts.operation,
    user: opts.user,
  });
}

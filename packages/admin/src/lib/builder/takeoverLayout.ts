/**
 * Generic entry/single-form field layout.
 *
 * Strips the system title/slug fields from the form body, then applies the
 * "takeover" rule: when a field whose type is a registered *takeover* type is
 * active (its `admin.condition` evaluates visible, or it has none), the body
 * collapses to just the takeover field(s) plus the field(s) that control their
 * conditions — hiding everything else. Title/slug/status render as separate
 * system components upstream and are unaffected.
 *
 * The rule is driven entirely by field-type metadata (`branding.plugins[]
 * .fieldTypes[].layout === "takeover"`) and the generic condition evaluator — no
 * plugin-specific knowledge lives here. A field counts as a takeover field when
 * its `type` matches the registered takeover type OR its `admin.component`
 * matches that type's editor component (so both the first-class `type` form and
 * the legacy `json` + `admin.component` form are recognized).
 *
 * @module lib/builder/takeoverLayout
 */
import type { FieldCondition } from "@admin/components/features/schema-builder/types";

import { evaluateCondition } from "./condition-evaluator";

/** A registered field type that takes over the form body when visible. */
export interface TakeoverType {
  type: string;
  /** The type's editor component path, used as an alternate match key. */
  component?: string;
}

export interface LayoutField {
  name?: string;
  type?: string;
  // Loose on purpose: any field config (FieldConfig, ManifestField, …) must be
  // assignable to LayoutField so the generic `T` binds to the caller's type. The
  // condition is cast to FieldCondition where it's actually evaluated.
  admin?: { condition?: unknown; component?: unknown } | null;
}

/** System fields rendered separately (never part of the editable body). */
const SYSTEM_FIELDS = new Set(["title", "slug"]);

function componentOf(f: LayoutField): string | undefined {
  const c = f.admin?.component;
  return typeof c === "string" ? c : undefined;
}

/** True when a field's type/component matches one of the takeover types. */
export function isTakeoverField(
  f: LayoutField,
  takeovers: TakeoverType[]
): boolean {
  return takeovers.some(
    t =>
      f.type === t.type ||
      (t.component !== undefined && componentOf(f) === t.component)
  );
}

/** The name of the field a takeover field's condition watches, if any. */
function controllerName(f: LayoutField): string | undefined {
  return (f.admin?.condition as FieldCondition | undefined)?.field;
}

/**
 * Field types flagged `layout: "takeover"` in the admin branding metadata,
 * paired with their editor component path.
 */
export function takeoverTypesFromBranding(
  plugins:
    | Array<{
        fieldTypes?: Array<{
          type: string;
          component?: string;
          layout?: string;
        }>;
      }>
    | undefined
): TakeoverType[] {
  const out: TakeoverType[] = [];
  for (const p of plugins ?? []) {
    for (const ft of p.fieldTypes ?? []) {
      if (ft.layout === "takeover") {
        out.push({ type: ft.type, component: ft.component });
      }
    }
  }
  return out;
}

/**
 * Names of the fields that control any takeover field's condition — the values
 * the form must watch so the layout recomputes when the user switches modes.
 */
export function takeoverControllerNames<T extends LayoutField>(
  fields: T[],
  takeovers: TakeoverType[]
): string[] {
  const names = new Set<string>();
  for (const f of fields) {
    if (isTakeoverField(f, takeovers)) {
      const c = controllerName(f);
      if (c) names.add(c);
    }
  }
  return [...names];
}

/**
 * Compute the fields to render in the form body. Returns the full body unless a
 * takeover field is active, in which case it returns only the takeover field(s)
 * and their condition controllers.
 */
export function computeMainFields<T extends LayoutField>(
  fields: T[],
  opts: { takeoverTypes: TakeoverType[]; values: Record<string, unknown> }
): T[] {
  const body = fields.filter(f => !SYSTEM_FIELDS.has(f.name ?? ""));

  const activeTakeovers = body.filter(
    f =>
      isTakeoverField(f, opts.takeoverTypes) &&
      evaluateCondition(
        f.admin?.condition as FieldCondition | undefined,
        valueFor(f, opts.values)
      )
  );
  if (activeTakeovers.length === 0) return body;

  const controllerNames = new Set(
    activeTakeovers
      .map(controllerName)
      .filter((n): n is string => typeof n === "string")
  );
  return body.filter(
    f =>
      isTakeoverField(f, opts.takeoverTypes) ||
      controllerNames.has(f.name ?? "")
  );
}

/** Resolve the value a field's condition source currently holds. */
function valueFor(f: LayoutField, values: Record<string, unknown>): unknown {
  const field = controllerName(f);
  return field ? values[field] : undefined;
}

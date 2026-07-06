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
 * plugin-specific knowledge lives here. The page-builder plugin is simply the
 * first field type to opt in.
 *
 * @module lib/builder/takeoverLayout
 */
import type { FieldCondition } from "@admin/components/features/schema-builder/types";

import { evaluateCondition } from "./condition-evaluator";

export interface LayoutField {
  name?: string;
  type?: string;
  admin?: { condition?: FieldCondition } | null;
}

/** System fields rendered separately (never part of the editable body). */
const SYSTEM_FIELDS = new Set(["title", "slug"]);

/** True when a field's type is one of the registered takeover types. */
export function isTakeoverField(
  f: LayoutField,
  takeoverTypes: Set<string>
): boolean {
  return typeof f.type === "string" && takeoverTypes.has(f.type);
}

/** The name of the field a takeover field's condition watches, if any. */
function controllerName(f: LayoutField): string | undefined {
  return f.admin?.condition?.field;
}

/**
 * Field types flagged `layout: "takeover"` in the admin branding metadata.
 */
export function takeoverTypesFromBranding(
  plugins:
    | Array<{ fieldTypes?: Array<{ type: string; layout?: string }> }>
    | undefined
): Set<string> {
  const set = new Set<string>();
  for (const p of plugins ?? []) {
    for (const ft of p.fieldTypes ?? []) {
      if (ft.layout === "takeover") set.add(ft.type);
    }
  }
  return set;
}

/**
 * Names of the fields that control any takeover field's condition — the values
 * the form must watch so the layout recomputes when the user switches modes.
 */
export function takeoverControllerNames<T extends LayoutField>(
  fields: T[],
  takeoverTypes: Set<string>
): string[] {
  const names = new Set<string>();
  for (const f of fields) {
    if (isTakeoverField(f, takeoverTypes)) {
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
  opts: { takeoverTypes: Set<string>; values: Record<string, unknown> }
): T[] {
  const body = fields.filter(f => !SYSTEM_FIELDS.has(f.name ?? ""));

  const activeTakeovers = body.filter(
    f =>
      isTakeoverField(f, opts.takeoverTypes) &&
      evaluateCondition(f.admin?.condition, valueFor(f, opts.values))
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

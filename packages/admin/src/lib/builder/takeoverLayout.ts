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
  admin?: { condition?: unknown; component?: unknown; hidden?: boolean } | null;
}

/** System fields rendered separately (never part of the editable body). */
const SYSTEM_FIELDS = new Set(["title", "slug"]);

/**
 * A field the entry form never renders inline (its value still lives in the form
 * state). Used for plugin plumbing like the page-builder mode field, which is
 * driven by a toolbar control instead of a visible field.
 */
function isHidden(f: LayoutField): boolean {
  return f.admin?.hidden === true;
}

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
  const body = fields.filter(
    f => !SYSTEM_FIELDS.has(f.name ?? "") && !isHidden(f)
  );

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

/**
 * What a takeover surface offers back, split the way its panel presents it.
 *
 * Two groups rather than one list, because they are answerable to different
 * things: `page` is what every document has and what a surface covering the
 * form takes away, while `content` is whatever this collection happens to
 * declare. A single list would put a page's slug between two of its own
 * relations, ordered by nothing an author can predict.
 */
export interface FieldsBeside<T> {
  /** The document's identity — title and slug — in the order declared. */
  page: T[];
  /** Everything else the form body would show. */
  content: T[];
}

/**
 * The fields a surface may offer BESIDE the one it was opened for.
 *
 * Everything the form body would show, minus the field at `excludePath` — the
 * field whose own surface is asking. A page builder rendering this inside its
 * own panel must not be offered itself, which would nest an editor in its own
 * settings.
 *
 * Deliberately NOT keyed on whether a takeover is active. `layout: "takeover"`
 * is declared in the branding type and no shipped plugin sets it, so a rule
 * conditioned on it would be inert: the body never collapses, and a panel
 * derived from "what the takeover hid" would be permanently empty. Excluding
 * one path by name works whether or not the body also shows these fields —
 * and while a full-screen surface covers the body, showing them is the only
 * way an author reaches them without leaving it.
 *
 * TITLE AND SLUG ARE OFFERED HERE, which they were not, and the reason they
 * were withheld is the reason they now belong: they are drawn by the system
 * header, so offering them again would have been a second, competing editor.
 * A surface that COVERS the form suppresses that header — the page builder
 * names it in `useSuppressAdminChrome` — so there is no second editor to
 * compete with and no first one to fall back on. Withholding them left the
 * commonest shape a collection takes, a title, a slug and a builder field,
 * with nothing to put in the panel at all: it was offered and opened blank,
 * and a document's own name could not be read from inside the editor.
 *
 * They stay grouped rather than merged so the panel can say which is which.
 */
export function computeFieldsBeside<T extends LayoutField>(
  fields: T[],
  excludePath: string
): FieldsBeside<T> {
  /*
   * The field whose value decides whether the asking field is visible at all is
   * withheld too.
   *
   * A page builder shown only when `editorMode === "page-builder"` would
   * otherwise offer `editorMode` inside its own panel, where changing it
   * un-renders the surface the author is standing in. Leaving the editor is
   * what the exit control is for; a settings panel should not be a second,
   * unlabelled way to do it.
   */
  const asking = fields.find(f => (f.name ?? "") === excludePath);
  const controller = asking === undefined ? undefined : controllerName(asking);
  const offered = fields.filter(
    f =>
      !isHidden(f) &&
      (f.name ?? "") !== excludePath &&
      (f.name ?? "") !== controller
  );
  // Partitioned from ONE filtered list rather than filtered twice, so a field
  // cannot land in both groups or in neither if the two predicates ever drift.
  return {
    page: offered.filter(f => SYSTEM_FIELDS.has(f.name ?? "")),
    content: offered.filter(f => !SYSTEM_FIELDS.has(f.name ?? "")),
  };
}

/** Resolve the value a field's condition source currently holds. */
function valueFor(f: LayoutField, values: Record<string, unknown>): unknown {
  const field = controllerName(f);
  return field ? values[field] : undefined;
}

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
  /**
   * A structured field's children, when it has any.
   *
   * Loose for the same reason `admin` is: every field-config shape must stay
   * assignable to this, and only the traversal below reads it.
   */
  fields?: readonly LayoutField[];
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
 * Whether a field's own condition currently lets it render.
 *
 * `FieldRenderer` returns `null` for a field whose condition is false, so a
 * caller counting fields without asking this counts rows that will not appear —
 * which is how a panel comes to be offered with a heading over a blank body.
 * Only the CONDITION is duplicated here, never the verdict: both sides call
 * `evaluateCondition`, so the semantics have one implementation and this adds
 * the lookup the renderer does with `useWatch`.
 *
 * A field with no condition is visible, and so is one whose condition names a
 * field this caller did not watch — an unwatched name reads as `undefined`,
 * and hiding a field on the strength of a value nobody supplied would withhold
 * a panel that has content in it.
 */
function isConditionallyVisible(
  f: LayoutField,
  values: Record<string, unknown>,
  basePath = ""
): boolean {
  const condition = f.admin?.condition as FieldCondition | undefined;
  const watches = watchedName(f, basePath);
  if (condition !== undefined && watches !== undefined) {
    if (watches in values && !evaluateCondition(condition, values[watches])) {
      return false;
    }
  }
  /*
   * A GROUP is only as visible as its contents. Its own condition passing says
   * the group may render; it does not say anything will be inside it, and
   * `GroupInput` sends each child through `FieldRenderer`, which answers null
   * for a condition that is false. A group whose every child is hidden draws
   * its label and its gutter over nothing — which, counted as content, offers
   * a panel with a heading and no control in it.
   *
   * An EMPTY `fields` list is left visible rather than hidden: a group that
   * declares no children is a schema the author wrote on purpose, and this is
   * not the place to decide it was a mistake.
   */
  const base = childBase(f, basePath);
  if (base === null || f.fields === undefined || f.fields.length === 0) {
    return true;
  }
  return f.fields.some(child => isConditionallyVisible(child, values, base));
}

/**
 * Every field name a condition on these fields watches.
 *
 * The set a caller must observe for {@link computeFieldsBeside} to answer about
 * the fields as they currently render rather than as they were declared. Kept
 * beside the rule that consumes it so the two cannot name different sets.
 */
export function conditionFieldNames<T extends LayoutField>(
  fields: readonly T[]
): string[] {
  const names = new Set<string>();
  collectConditionNames(fields, "", names);
  return [...names];
}

/**
 * The qualified name a field's condition watches, or undefined for no condition.
 *
 * QUALIFIED BY THE PATH, because `FieldRenderer` resolves a nested condition
 * against the field's own base — a child of the `seo` group watching `mode`
 * watches `seo.mode`. Collecting the bare name would subscribe to a top-level
 * field that usually does not exist, and judging visibility against it would
 * read `undefined` for a condition that is really satisfied.
 */
function watchedName(f: LayoutField, basePath: string): string | undefined {
  const watches = (f.admin?.condition as FieldCondition | undefined)?.field;
  if (watches === undefined) return undefined;
  return basePath === "" ? watches : `${basePath}.${watches}`;
}

/**
 * The path a structured field's children are addressed under, or null when this
 * field's children are not addressed from the form root at all.
 *
 * A GROUP's children render directly and their values live at
 * `group.child`, so the walk continues into them. A REPEATER's `fields` are a
 * ROW TEMPLATE — they describe what each row contains, their conditions are
 * evaluated per row against that row's values, and the repeater itself renders
 * its add control whether or not it holds any. Walking into one would collect
 * names that address nothing and could hide a repeater that draws perfectly
 * well, so it deliberately stops here.
 */
function childBase(f: LayoutField, basePath: string): string | null {
  if (f.type !== "group" || f.fields === undefined) return null;
  const own = f.name ?? "";
  if (own === "") return basePath;
  return basePath === "" ? own : `${basePath}.${own}`;
}

function collectConditionNames(
  fields: readonly LayoutField[],
  basePath: string,
  into: Set<string>
): void {
  for (const f of fields) {
    const watches = watchedName(f, basePath);
    if (watches !== undefined) into.add(watches);
    const base = childBase(f, basePath);
    if (base !== null && f.fields !== undefined) {
      collectConditionNames(f.fields, base, into);
    }
  }
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
  excludePath: string,
  values: Record<string, unknown> = {}
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
      isConditionallyVisible(f, values) &&
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

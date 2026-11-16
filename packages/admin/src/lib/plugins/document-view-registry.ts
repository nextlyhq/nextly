/**
 * Client-side registry of plugin-contributed document views.
 *
 * A document view is a full-screen screen of one document, served under the
 * document's own address: `/admin/collections/<slug>/<id>/<path>`, or
 * `/admin/singles/<slug>/<path>` for a Single. `resolveRoute` asks this
 * registry whether the last segment of such an address names a view the slug
 * actually has, so an address nobody declared renders the not-found page
 * rather than an editor drawing nothing.
 *
 * Module-level singleton (mirrors `plugin-route-registry`), rebuilt from
 * `branding.plugins[].documentViews` when admin-meta loads. The server has
 * already refused malformed, reserved and twice-claimed paths at boot, so this
 * holds exactly what it is given.
 *
 * @module lib/plugins/document-view-registry
 */
import type { PluginMetadata } from "@admin/types/branding";

import {
  addressesIn,
  addressOfFormPath,
  hasRowStep,
  locationLabel,
  resolveAddress,
  rowsCarryIds,
  type AddressedRow,
  type AddressStep,
  type FormPathAddress,
  type RowAddressRefusal,
} from "./field-address";

/**
 * One view, in the shape admin-meta delivers it. Derived from the metadata
 * type rather than restated, so a field the server adds to a view reaches the
 * registry without a second declaration to keep in step.
 */
export type RegisteredDocumentView = NonNullable<
  PluginMetadata["documentViews"]
>[number];

/**
 * Which kind of document an address is of. A collection and a Single may share
 * a slug, so a view declared on a slug — which `views[slug]` declares for a
 * COLLECTION, as every view slot there does — must not answer a Single's
 * address of the same slug. Field-type views answer either.
 */
export type DocumentKind = "collection" | "single";

/**
 * The query keys a document view's address uses to name a part of the
 * document: `field`, which of its fields the view edits, and `section`, the
 * part of that field it opens at. The form does not read them, so moving
 * between the document's edit address and its views with or without them stays
 * on the same document, and leaving a view drops them.
 *
 * One list for both of those readers. Kept apart, the leave guard came to
 * accept a key the way back still carried, or the reverse.
 */
export const DOCUMENT_VIEW_ADDRESS_PARAMS: readonly string[] = [
  "field",
  "section",
];

const registry = new Map<string, RegisteredDocumentView>();

/**
 * Views offered on every document with a top-level field of their type, by
 * path. Boot holds each such path unique among every view, so one path names
 * at most one of these and none of the slug-scoped ones.
 */
const byFieldType = new Map<string, RegisteredDocumentView>();

/**
 * One key per slug and path. JSON rather than a joined string, because a slug
 * and a path are both free text to this module and a delimiter inside either
 * would make two different pairs one key.
 */
function viewKey(slug: string, path: string): string {
  return JSON.stringify([slug, path]);
}

/** Register every view in `views`, each under its own slug and path. */
export function registerDocumentViews(
  views: readonly RegisteredDocumentView[]
): void {
  for (const view of views) {
    if ("slug" in view) registry.set(viewKey(view.slug, view.path), view);
    else byFieldType.set(view.path, view);
  }
}

/**
 * The view at `path` on `slug`: one declared on the slug, else one offered on
 * a field type — a CANDIDATE, which applies only if the document has that field
 * (`documentViewApplies`), something only the page holding the schema knows.
 */
export function matchDocumentView(
  kind: DocumentKind,
  slug: string,
  path: string
): RegisteredDocumentView | undefined {
  const declared =
    kind === "collection" ? registry.get(viewKey(slug, path)) : undefined;
  return declared ?? byFieldType.get(path);
}

/** A field a document addresses, with the containers it sits inside. */
interface AddressableField<F extends object> {
  field: F;
  /**
   * The groups and repeaters around it, outermost first. The form applies
   * their gates to it — a read-only or hidden group makes everything inside it
   * read-only or hidden — so a surface editing the field on its own needs them
   * too.
   */
  within: F[];
  /**
   * Its path in the form: its name, after each named group's around it. A
   * repeater's row on the way is spelled `*` here, since it is no one row;
   * `steps` is the path to resolve a row by.
   */
  path: string;
  /**
   * The path each of `within` and then the field itself sits under, the base a
   * condition on that step reads its value beside. An unnamed group adds
   * nothing to it; a named group adds its name for what it holds.
   */
  bases: string[];
  /** The path as steps, with each repeater's row a step of its own. */
  steps: AddressStep<F>[];
  /**
   * How many of `steps` each base in `bases` is: a base is always the start of
   * the field's own path, so a row's base is spelled once the row is known.
   */
  baseDepths: number[];
}

/** A field's own name, or `undefined` for none (an unnamed group). */
function nameOf(field: object): string | undefined {
  return "name" in field && typeof field.name === "string" && field.name !== ""
    ? field.name
    : undefined;
}

/** Steps spelled as a path, a row as `*` where no row is known. */
function spelled<F extends object>(steps: readonly AddressStep<F>[]): string {
  return steps.map(step => (step.kind === "name" ? step.name : "*")).join(".");
}

/**
 * The fields a document addresses, walking into containers: always into an
 * UNNAMED group, which is presentation only and adds nothing to a path, and
 * only `throughContainers` into a NAMED group, whose name becomes a step of
 * the path, and into a repeater, whose name and then the row become steps.
 *
 * Raw config can hold a cycle, a group that lays itself out directly or
 * through another, so a container already open on its own path (`within`) is
 * not walked again: without that, every caller recursed until the stack ran
 * out.
 */
function walkFields<F extends object>(
  fields: readonly F[] | undefined,
  throughContainers: boolean,
  within: F[] = [],
  baseDepths: number[] = [],
  steps: AddressStep<F>[] = []
): AddressableField<F>[] {
  return (fields ?? []).flatMap(field => {
    const name = nameOf(field);
    const ownSteps: AddressStep<F>[] =
      name === undefined ? steps : [...steps, { kind: "name", name }];
    const ownDepths = [...baseDepths, steps.length];
    const own: AddressableField<F> = {
      field,
      within,
      path: spelled(ownSteps),
      bases: ownDepths.map(depth => spelled(ownSteps.slice(0, depth))),
      steps: ownSteps,
      baseDepths: ownDepths,
    };
    const type = "type" in field ? field.type : undefined;
    const group = type === "group";
    // A repeater's rows are reached through its name, so a nameless one has
    // no rows to address.
    const repeater = type === "repeater" && name !== undefined;
    if (!group && !repeater) return [own];
    if (name !== undefined && !throughContainers) return [own];
    if (within.includes(field)) return [];
    const children = "fields" in field ? field.fields : undefined;
    // A repeater's fields sit inside one of its rows, a step of its own.
    const inner: AddressStep<F>[] = repeater
      ? [...ownSteps, { kind: "row", repeater: field }]
      : ownSteps;
    // A container's children are declarations of the same kind as it, so
    // they are read as the caller's field type.
    const inside = Array.isArray(children)
      ? walkFields(
          children as F[],
          throughContainers,
          [...within, field],
          ownDepths,
          inner
        )
      : [];
    // A named container is itself a field of the document; an unnamed one is
    // not.
    return name === undefined ? inside : [own, ...inside];
  });
}

/**
 * The fields a document addresses at its top level: its own, plus those of any
 * UNNAMED group. A named group or a repeater moves its fields down a level.
 */
export function addressableFieldsWithin<F extends object>(
  fields: readonly F[] | undefined
): AddressableField<F>[] {
  return walkFields(fields, false);
}

/**
 * The fields a document view can edit: the top-level ones and, at any depth,
 * those inside named groups and inside repeaters' rows. The same walk as
 * above, also stepping into named containers.
 */
function viewableFields<F extends object>(
  fields: readonly F[] | undefined
): AddressableField<F>[] {
  return walkFields(fields, true);
}

/**
 * Whether every repeater on a path gives its rows a saved id, so each row can
 * be addressed: a repeater whose rows declare their own `id` field does not.
 */
function rowsAddressable<F extends object>(
  steps: readonly AddressStep<F>[]
): boolean {
  return steps.every(
    step => step.kind === "name" || rowsCarryIds(step.repeater)
  );
}

/**
 * Whether a matched view applies to a document with these top-level fields.
 * A slug-scoped view always does; a field-type view where a field of its type
 * sits at the top level, inside groups, or inside the rows of a repeater
 * whose rows have saved ids.
 */
export function documentViewApplies(
  view: RegisteredDocumentView,
  fields: readonly object[] | undefined
): boolean {
  if (!("fieldType" in view)) return true;
  return viewableFields(fields).some(
    ({ field, steps }) =>
      "type" in field && field.type === view.fieldType && rowsAddressable(steps)
  );
}

/** Clear every registered view (rebuild on admin-meta change / tests). */
export function clearDocumentViews(): void {
  registry.clear();
  byFieldType.clear();
}

/**
 * The view a route's params name, or `undefined` when they name none.
 *
 * The one reading of a document-view address, shared by the resolver that
 * decides whether the address is found and the page that draws the view, so
 * the two cannot disagree about what is at it. Takes the router's loose param
 * values: a missing or repeated segment names no view.
 */
export function routedDocumentView(
  kind: DocumentKind,
  slug: string | string[] | undefined,
  view: string | string[] | undefined
): RegisteredDocumentView | undefined {
  if (typeof slug !== "string" || typeof view !== "string") return undefined;
  return matchDocumentView(kind, slug, view);
}

/**
 * Whether a route's params name a view that does not apply to this document:
 * one offered on a field type the document has no top-level field of. Such an
 * address names nothing, exactly as an undeclared view does. One call for the
 * pages, so the decision is made here and not spelled out in each.
 */
export function documentViewMissing(
  kind: DocumentKind,
  slug: string | string[] | undefined,
  view: string | string[] | undefined,
  fields: readonly object[] | undefined
): boolean {
  const routed = routedDocumentView(kind, slug, view);
  return routed !== undefined && !documentViewApplies(routed, fields);
}

/**
 * The view a route's params name that applies to this document: what the page
 * draws at the address, or `undefined`. A registered view that does not apply
 * renders not found, exactly as an undeclared one does, so whoever asks
 * whether an address keeps the document's page asks this rather than whether a
 * view is registered.
 */
export function drawnDocumentView(
  kind: DocumentKind,
  slug: string | string[] | undefined,
  view: string | string[] | undefined,
  fields: readonly object[] | undefined
): RegisteredDocumentView | undefined {
  const routed = routedDocumentView(kind, slug, view);
  return routed !== undefined && documentViewApplies(routed, fields)
    ? routed
    : undefined;
}

/**
 * The page of a collection's own edit view that a route's params name, or
 * `undefined` when they name none.
 *
 * A custom edit view with tabs of its own (a form's Builder, Settings and
 * Submissions) gives each tab an address by declaring a document view on its
 * slug whose component IS that edit view. Such an address is a page of the
 * editor, not a screen of its own: the edit view draws it, told which page,
 * and stays mounted from one page to the next, so what is unsaved on one tab
 * is still there on the next. Read from the same lookup the resolver uses to
 * let the address through, so the page drawn is the page found.
 */
export function editViewPage(
  slug: string | string[] | undefined,
  view: string | string[] | undefined,
  editView: string | undefined
): string | undefined {
  if (editView === undefined) return undefined;
  const routed = routedDocumentView("collection", slug, view);
  // Declared on this collection, not offered on a field type: a field-type
  // view that happened to draw the same component would otherwise skip the
  // check that the document has its field.
  return routed !== undefined &&
    "slug" in routed &&
    routed.slug === slug &&
    routed.component === editView
    ? routed.path
    : undefined;
}

/**
 * Whether a collection's custom edit view has pages of its own: some document
 * view declared on the slug draws that same edit view (`editViewPage`).
 *
 * Such an edit view is a whole editor with its own header and tabs, as the
 * default editor is, so the page gives it the editor's frame rather than the
 * padded one a plain custom edit view is drawn in.
 */
export function editViewHasPages(
  slug: string | undefined,
  editView: string | undefined
): boolean {
  if (slug === undefined || editView === undefined) return false;
  for (const view of registry.values()) {
    if ("slug" in view && view.slug === slug && view.component === editView) {
      return true;
    }
  }
  return false;
}

/**
 * A field a view could edit: its address (`hero.body` for a field in a `hero`
 * group, `sections.<rowId>.body` for one in a repeater's row) and label for the
 * chooser, and its declaration for the view.
 */
export interface ViewFieldCandidate<F extends object = object> {
  /** Its address from the document's root, which `?field=` carries. */
  name: string;
  label?: string;
  declaration: F;
  /** The containers around it, outermost first, whose gates it inherits. */
  within: F[];
  /** The base path each of `within` and then the field reads conditions under. */
  bases: string[];
  /**
   * Where it sits in the form now, for a field in a repeater's row: the form
   * names the row by its position, the address by its id. Absent where the
   * two are the same, which is everywhere else.
   */
  formPath?: string;
  /**
   * Where it sits, in words, for a field below the top level: each
   * container's label and each row's title, then the field's label
   * (`Sections · Hero banner · Body`).
   */
  location?: string;
}

/**
 * The document's values a row's address is read in: the form's values now,
 * and as last loaded or stored, where a row's id is saved. Only the
 * containers holding rows are read.
 */
export interface ViewFieldValues {
  current: Record<string, unknown> | undefined;
  saved: Record<string, unknown> | undefined;
}

/**
 * What a view edits: the whole document, one field, or — where the document
 * has several fields the view could edit and the address names none of them —
 * the author's choice; or nothing, where the address names a repeater's row it
 * cannot open, and why.
 */
export type ViewFieldResolution<F extends object = object> =
  | { kind: "document" }
  | ({ kind: "field" } & Omit<ViewFieldCandidate<F>, "label">)
  | { kind: "choose"; candidates: ViewFieldCandidate<F>[] }
  | { kind: "refused"; reason: RowAddressRefusal };

/** Whether a walked field is a named field of `fieldType`. */
function ofType<F extends object>(
  entry: AddressableField<F>,
  fieldType: string
): boolean {
  const { field } = entry;
  return (
    "type" in field && field.type === fieldType && nameOf(field) !== undefined
  );
}

/**
 * A walked field as a candidate at `address`, which names it at `formPath` in
 * the values read, through `rows`.
 */
function candidateAt<F extends object>(
  entry: AddressableField<F>,
  address: string,
  formPath: string,
  rows: AddressedRow<F>[]
): ViewFieldCandidate<F> {
  const { field, within, steps, baseDepths } = entry;
  const formParts = formPath.split(".");
  const label =
    "label" in field && typeof field.label === "string"
      ? { label: field.label }
      : {};
  // The named declarations along the path, one for each name step: the named
  // containers around the field, then the field.
  const named = [
    ...within.filter(container => nameOf(container) !== undefined),
    field,
  ];
  return {
    name: address,
    ...label,
    declaration: field,
    within,
    // Each base is the start of the field's own form path, so a condition
    // inside a row reads beside that row, as the form reads it.
    bases: baseDepths.map(depth => formParts.slice(0, depth).join(".")),
    ...(hasRowStep(steps) ? { formPath } : {}),
    ...(steps.length > 1
      ? { location: locationLabel(steps, named, rows) }
      : {}),
  };
}

/**
 * The fields of `fieldType` a view can edit, by address and label: each one
 * outside repeaters, and inside a repeater, one for each row whose id is
 * saved, read in `values`. Without values, no row is offered.
 */
export function viewFieldCandidates<F extends object>(
  fieldType: string,
  fields: readonly F[] | undefined,
  values?: ViewFieldValues
): ViewFieldCandidate<F>[] {
  return viewableFields(fields).flatMap(entry => {
    if (!ofType(entry, fieldType)) return [];
    if (!hasRowStep(entry.steps)) {
      return [candidateAt(entry, entry.path, entry.path, [])];
    }
    return addressesIn(entry.steps, values?.current).flatMap(address => {
      const now = resolveAddress(entry.steps, address, values?.current);
      // Offered only where the row is saved with that id, as the field's own
      // way in offers it: a row added since cannot be found after a reload.
      const stored = resolveAddress(entry.steps, address, values?.saved);
      return now?.kind === "found" && stored?.kind === "found"
        ? [candidateAt(entry, address, now.formPath, now.rows)]
        : [];
    });
  });
}

/**
 * A candidate as the field a view edits. Its chooser label stays behind: the
 * view reads the declaration's own.
 */
function asField<F extends object>(
  candidate: ViewFieldCandidate<F>
): ViewFieldResolution<F> {
  const { name, declaration, within, bases, formPath, location } = candidate;
  return {
    kind: "field",
    name,
    declaration,
    within,
    bases,
    ...(formPath === undefined ? {} : { formPath }),
    ...(location === undefined ? {} : { location }),
  };
}

/**
 * The field a row address names, found by the row's id in `values`; or why
 * it opens none. `undefined` when the address is no path through a row of a
 * field of `fieldType`.
 */
function rowField<F extends object>(
  fieldType: string,
  fields: readonly F[] | undefined,
  requested: string,
  values: ViewFieldValues | undefined
): ViewFieldResolution<F> | undefined {
  for (const entry of viewableFields(fields)) {
    if (!ofType(entry, fieldType) || !hasRowStep(entry.steps)) continue;
    const found = resolveAddress(entry.steps, requested, values?.current);
    if (found === null) continue;
    if (found.kind === "refused") {
      return { kind: "refused", reason: found.reason };
    }
    return asField(candidateAt(entry, requested, found.formPath, found.rows));
  }
  return undefined;
}

/**
 * Which field a document view edits, given the document's top-level fields and
 * the field the address asks for (`?field=`).
 *
 * A view scoped to a field type edits one field of that type: the one the
 * address names; otherwise the only one the author may edit. An address naming
 * none, or naming something that is not such a field, is asked rather than
 * guessed: opening the wrong one of two looks like the right editor showing the
 * wrong content, which an author cannot tell from a lost page. The question
 * offers only the fields the author may edit, as `admits` says.
 *
 * An address through a repeater's row names the row by its saved id, found in
 * `values` wherever the row now stands. One whose row is gone, or that names a
 * row by its position, is refused: never corrected to the only field, and
 * never pointed at whichever row now stands where it stood. Nor is a stale
 * address ever corrected onto a row.
 */
export function resolveViewField<F extends object>(
  fieldType: string | undefined,
  fields: readonly F[] | undefined,
  requested: string | undefined,
  /** Whether the author may edit a field; every field, unless said. */
  admits: (candidate: ViewFieldCandidate<F>) => boolean = () => true,
  values?: ViewFieldValues
): ViewFieldResolution<F> {
  if (fieldType === undefined) return { kind: "document" };
  const throughRow =
    requested === undefined
      ? undefined
      : rowField(fieldType, fields, requested, values);
  if (throughRow !== undefined) return throughRow;
  const candidates = viewFieldCandidates(fieldType, fields, values);
  // A field the address names is the one meant, whatever may be done with
  // it: the author who followed that address learns why it will not open,
  // rather than meeting another field in its place.
  const named = candidates.find(candidate => candidate.name === requested);
  // Otherwise, only the fields the author may edit are offered. Where none
  // may be, all of them are, so the author still meets the reason.
  const offered = candidates.filter(admits);
  const choices = offered.length > 0 ? offered : candidates;
  // The only field opens without asking, unless it is a row's: a row is
  // opened only by an address that names it.
  const only = choices.length === 1 ? choices[0] : undefined;
  const chosen =
    named ??
    (only !== undefined && only.formPath === undefined ? only : undefined);
  if (chosen !== undefined) return asField(chosen);
  return { kind: "choose", candidates: choices };
}

/**
 * The top-level fields holding a repeater row that a field of `fieldType` sits
 * in: what a view of the document watches, so the row its address names is
 * found again wherever the row moves, without watching the whole document.
 */
export function rowContainerRoots<F extends object>(
  fieldType: string | undefined,
  fields: readonly F[] | undefined
): string[] {
  if (fieldType === undefined) return [];
  const roots = viewableFields(fields).flatMap(entry => {
    const first = entry.steps[0];
    return ofType(entry, fieldType) &&
      hasRowStep(entry.steps) &&
      first?.kind === "name"
      ? [first.name]
      : [];
  });
  return [...new Set(roots)];
}

/**
 * Where `address` names its field in `values` — any copy of the document's
 * values, the form's now, as stored, or a recovery point — or `undefined`
 * where it names none there. A row is found by its id, so the answer follows a
 * row that has moved and is `undefined` for one that is gone. The same
 * resolution the view's field is chosen by.
 */
export function viewFieldPathIn<F extends object>(
  fieldType: string,
  fields: readonly F[] | undefined,
  address: string,
  values: Record<string, unknown> | undefined
): string | undefined {
  const through = rowField(fieldType, fields, address, {
    current: values,
    saved: undefined,
  });
  if (through === undefined) return address;
  return through.kind === "field"
    ? (through.formPath ?? through.name)
    : undefined;
}

/**
 * The address of the field at `formPath` inside a repeater's row: its rows
 * named by their saved ids, or why it has none yet. `undefined` where the
 * form path runs through no row of `fields`. The other direction of the
 * resolution a view reads its address by, from the same walk.
 */
export function rowFieldAddress<F extends object>(
  fields: readonly F[] | undefined,
  formPath: string,
  values: Record<string, unknown> | undefined,
  saved: Record<string, unknown> | undefined
): FormPathAddress | undefined {
  for (const entry of viewableFields(fields)) {
    if (!hasRowStep(entry.steps)) continue;
    const found = addressOfFormPath(entry.steps, formPath, values, saved);
    if (found !== null) return found;
  }
  return undefined;
}

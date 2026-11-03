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

/** A field a document addresses, with the groups it sits inside. */
interface AddressableField<F extends object> {
  field: F;
  /**
   * The groups around it, outermost first. The form applies their gates to it
   * — a read-only or hidden group makes everything inside it read-only or
   * hidden — so a surface editing the field on its own needs them too.
   */
  within: F[];
  /** Its path in the form: its name, after each named group's around it. */
  path: string;
  /**
   * The path each of `within` and then the field itself sits under, the base a
   * condition on that step reads its value beside. An unnamed group adds
   * nothing to it; a named group adds its name for what it holds.
   */
  bases: string[];
}

/** A field's own name, or `undefined` for none (an unnamed group). */
function nameOf(field: object): string | undefined {
  return "name" in field && typeof field.name === "string" && field.name !== ""
    ? field.name
    : undefined;
}

/**
 * The fields a document addresses, walking into groups: always into an
 * UNNAMED group, which is presentation only and adds nothing to a path, and
 * into a NAMED group only `throughNamedGroups`, where its name becomes a step
 * of the path. A repeater is never walked: its rows have no address that
 * survives a reorder.
 *
 * Raw config can hold a cycle, a group that lays itself out directly or
 * through another, so a group already open on its own path (`within`) is not
 * walked again: without that, every caller recursed until the stack ran out.
 */
function walkFields<F extends object>(
  fields: readonly F[] | undefined,
  throughNamedGroups: boolean,
  within: F[] = [],
  bases: string[] = [],
  base = ""
): AddressableField<F>[] {
  return (fields ?? []).flatMap(field => {
    const name = nameOf(field);
    const path = name === undefined ? base : base ? `${base}.${name}` : name;
    const own = { field, within, path, bases: [...bases, base] };
    const group = "type" in field && field.type === "group";
    if (!group || (name !== undefined && !throughNamedGroups)) return [own];
    if (within.includes(field)) return [];
    const children = "fields" in field ? field.fields : undefined;
    // A group's children are declarations of the same kind as the group, so
    // they are read as the caller's field type.
    const inside = Array.isArray(children)
      ? walkFields(
          children as F[],
          throughNamedGroups,
          [...within, field],
          [...bases, base],
          path
        )
      : [];
    // A named group is itself a field of the document; an unnamed one is not.
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
 * those inside named groups, each with its path. The same walk as above, also
 * stepping into named groups; repeaters stay out of reach.
 */
function viewableFields<F extends object>(
  fields: readonly F[] | undefined
): AddressableField<F>[] {
  return walkFields(fields, true);
}

/**
 * Whether a matched view applies to a document with these top-level fields.
 * A slug-scoped view always does; a field-type view where a field of its type
 * sits at the top level or inside groups. One inside a repeater does not
 * count: a row has no address that survives a reorder.
 */
export function documentViewApplies(
  view: RegisteredDocumentView,
  fields: readonly object[] | undefined
): boolean {
  if (!("fieldType" in view)) return true;
  return viewableFields(fields).some(
    ({ field }) => "type" in field && field.type === view.fieldType
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
 * A field a view could edit: its path (which the address names, `hero.body`
 * for a field in a `hero` group) and label for the chooser, and its
 * declaration for the view.
 */
export interface ViewFieldCandidate<F extends object = object> {
  name: string;
  label?: string;
  declaration: F;
  /** The groups around it, outermost first, whose gates it inherits. */
  within: F[];
  /** The base path each of `within` and then the field reads conditions under. */
  bases: string[];
}

/**
 * What a view edits: the whole document, one field, or — where the document
 * has several fields the view could edit and the address names none of them —
 * the author's choice.
 */
export type ViewFieldResolution<F extends object = object> =
  | { kind: "document" }
  | {
      kind: "field";
      name: string;
      declaration: F;
      within: F[];
      bases: string[];
    }
  | { kind: "choose"; candidates: ViewFieldCandidate<F>[] };

/** The fields of `fieldType` a view can edit, by path and label. */
export function viewFieldCandidates<F extends object>(
  fieldType: string,
  fields: readonly F[] | undefined
): ViewFieldCandidate<F>[] {
  return viewableFields(fields).flatMap(({ field, within, path, bases }) => {
    if (!("type" in field) || field.type !== fieldType) return [];
    if (nameOf(field) === undefined) return [];
    const label =
      "label" in field && typeof field.label === "string"
        ? { label: field.label }
        : {};
    return [{ name: path, ...label, declaration: field, within, bases }];
  });
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
 */
export function resolveViewField<F extends object>(
  fieldType: string | undefined,
  fields: readonly F[] | undefined,
  requested: string | undefined,
  /** Whether the author may edit a field; every field, unless said. */
  admits: (candidate: ViewFieldCandidate<F>) => boolean = () => true
): ViewFieldResolution<F> {
  if (fieldType === undefined) return { kind: "document" };
  const candidates = viewFieldCandidates(fieldType, fields);
  // A field the address names is the one meant, whatever may be done with
  // it: the author who followed that address learns why it will not open,
  // rather than meeting another field in its place.
  const named = candidates.find(candidate => candidate.name === requested);
  // Otherwise, only the fields the author may edit are offered. Where none
  // may be, all of them are, so the author still meets the reason.
  const offered = candidates.filter(admits);
  const choices = offered.length > 0 ? offered : candidates;
  const chosen = named ?? (choices.length === 1 ? choices[0] : undefined);
  if (chosen !== undefined) {
    return {
      kind: "field",
      name: chosen.name,
      declaration: chosen.declaration,
      within: chosen.within,
      bases: chosen.bases,
    };
  }
  return { kind: "choose", candidates: choices };
}

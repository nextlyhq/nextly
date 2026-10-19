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

/** A field a document addresses, with the unnamed groups it sits inside. */
interface AddressableField<F extends object> {
  field: F;
  /**
   * The unnamed groups around it, outermost first. They add nothing to its
   * path, but the form applies their gates to it — a read-only or hidden group
   * makes everything inside it read-only or hidden — so a surface editing the
   * field on its own needs them too.
   */
  within: F[];
}

/**
 * The fields a document addresses at its top level: its own, plus those of any
 * UNNAMED group, which is presentation only and adds nothing to their paths. A
 * named group or a repeater moves its fields down a level, out of reach.
 */
function addressableFieldsWithin<F extends object>(
  fields: readonly F[] | undefined,
  within: F[] = []
): AddressableField<F>[] {
  return (fields ?? []).flatMap(field => {
    const unnamedGroup =
      "type" in field &&
      field.type === "group" &&
      !("name" in field && typeof field.name === "string" && field.name !== "");
    if (!unnamedGroup) return [{ field, within }];
    const children = "fields" in field ? field.fields : undefined;
    // A group's children are declarations of the same kind as the group, so
    // they are read as the caller's field type.
    return Array.isArray(children)
      ? addressableFieldsWithin(children as F[], [...within, field])
      : [];
  });
}

/** The addressable fields alone, derived from the one walk above. */
function addressableFields<F extends object>(
  fields: readonly F[] | undefined
): F[] {
  return addressableFieldsWithin(fields).map(entry => entry.field);
}

/**
 * Whether a matched view applies to a document with these top-level fields.
 * A slug-scoped view always does; a field-type view only where a TOP-LEVEL
 * field has its type. A field inside a group or a repeater does not count.
 */
export function documentViewApplies(
  view: RegisteredDocumentView,
  fields: readonly object[] | undefined
): boolean {
  if (!("fieldType" in view)) return true;
  return addressableFields(fields).some(
    field => "type" in field && field.type === view.fieldType
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

/** A field a view could edit: its name and label for the chooser, and its declaration for the view. */
export interface ViewFieldCandidate<F extends object = object> {
  name: string;
  label?: string;
  declaration: F;
  /** The unnamed groups around it, outermost first, whose gates it inherits. */
  within: F[];
}

/**
 * What a view edits: the whole document, one field, or — where the document
 * has several fields the view could edit and the address names none of them —
 * the author's choice.
 */
export type ViewFieldResolution<F extends object = object> =
  | { kind: "document" }
  | { kind: "field"; name: string; declaration: F; within: F[] }
  | { kind: "choose"; candidates: ViewFieldCandidate<F>[] };

/** The top-level fields of `fieldType`, by name and label. */
export function viewFieldCandidates<F extends object>(
  fieldType: string,
  fields: readonly F[] | undefined
): ViewFieldCandidate<F>[] {
  return addressableFieldsWithin(fields).flatMap(({ field, within }) => {
    if (!("type" in field) || field.type !== fieldType) return [];
    if (!("name" in field) || typeof field.name !== "string") return [];
    const label =
      "label" in field && typeof field.label === "string"
        ? { label: field.label }
        : {};
    return [{ name: field.name, ...label, declaration: field, within }];
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
    };
  }
  return { kind: "choose", candidates: choices };
}

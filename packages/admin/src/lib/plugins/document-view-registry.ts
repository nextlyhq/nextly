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
  slug: string,
  path: string
): RegisteredDocumentView | undefined {
  return registry.get(viewKey(slug, path)) ?? byFieldType.get(path);
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
  return (fields ?? []).some(
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
  slug: string | string[] | undefined,
  view: string | string[] | undefined
): RegisteredDocumentView | undefined {
  if (typeof slug !== "string" || typeof view !== "string") return undefined;
  return matchDocumentView(slug, view);
}

/**
 * Whether a route's params name a view that does not apply to this document:
 * one offered on a field type the document has no top-level field of. Such an
 * address names nothing, exactly as an undeclared view does. One call for the
 * pages, so the decision is made here and not spelled out in each.
 */
export function documentViewMissing(
  slug: string | string[] | undefined,
  view: string | string[] | undefined,
  fields: readonly object[] | undefined
): boolean {
  const routed = routedDocumentView(slug, view);
  return routed !== undefined && !documentViewApplies(routed, fields);
}

/** A field a view could edit, as the chooser names it. */
export interface ViewFieldCandidate {
  name: string;
  label?: string;
}

/**
 * What a view edits: the whole document, one field, or — where the document
 * has several fields the view could edit and the address names none of them —
 * the author's choice.
 */
export type ViewFieldResolution =
  | { kind: "document" }
  | { kind: "field"; name: string }
  | { kind: "choose"; candidates: ViewFieldCandidate[] };

/** The top-level fields of `fieldType`, by name and label. */
function candidatesOf(
  fieldType: string,
  fields: readonly object[] | undefined
): ViewFieldCandidate[] {
  return (fields ?? []).flatMap(field => {
    if (!("type" in field) || field.type !== fieldType) return [];
    if (!("name" in field) || typeof field.name !== "string") return [];
    const label =
      "label" in field && typeof field.label === "string"
        ? { label: field.label }
        : {};
    return [{ name: field.name, ...label }];
  });
}

/**
 * Which field a document view edits, given the document's top-level fields and
 * the field the address asks for (`?field=`).
 *
 * A view scoped to a field type edits one field of that type. The only one, if
 * there is one; otherwise the one the address names. An address naming none,
 * or naming something that is not such a field, is asked rather than guessed:
 * opening the wrong one of two looks like the right editor showing the wrong
 * content, which an author cannot tell from a lost page.
 */
export function resolveViewField(
  fieldType: string | undefined,
  fields: readonly object[] | undefined,
  requested: string | undefined
): ViewFieldResolution {
  if (fieldType === undefined) return { kind: "document" };
  const candidates = candidatesOf(fieldType, fields);
  if (candidates.length === 1) {
    return { kind: "field", name: candidates[0].name };
  }
  const named = candidates.find(candidate => candidate.name === requested);
  if (named !== undefined) return { kind: "field", name: named.name };
  return { kind: "choose", candidates };
}

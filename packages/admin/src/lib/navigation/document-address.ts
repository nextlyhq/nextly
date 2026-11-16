/**
 * Where a link meant to open a document goes: the one rule every such link in
 * the admin uses (a list row, a dashboard card's row), so the same click
 * always opens the same place, whoever made the link.
 *
 * For a collection's entry:
 *
 * 1. The collection's `admin.opensIn`, when it declares one: the form, or a
 *    document view it has.
 * 2. Else the view that asks to open first (`opensFirst: "mainField"`) for
 *    the field type of the collection's main field.
 * 3. Else the form.
 *
 * Then the form, whatever those say, for a reader who may not update the
 * entry (a view edits it) and for an entry asked for in a language other than
 * the default (a view edits the default language). A view that is not
 * published, because its plugin is off or gone, leaves the form too.
 *
 * Read from the collection as it is now, so a collection made in the Schema
 * Builder follows the rule as its fields change, and from the views the
 * admin's metadata publishes (enabled plugins' only), handed in rather than
 * read from the route registry, which fills in an effect after that metadata
 * renders. Nothing is remembered per person. The form's own address is never
 * changed by any of this.
 *
 * A Single opens as its form for now; the rule takes the kind so a Single can
 * follow it later.
 *
 * @module lib/navigation/document-address
 */
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { LOCALE_PARAM } from "@admin/constants/search-params";
import {
  addressableFieldsWithin,
  documentViewApplies,
  type DocumentKind,
  type RegisteredDocumentView,
} from "@admin/lib/plugins/document-view-registry";

/** What `opensIn` says to keep a collection's entries in the form. */
const FORM = "form";

/** The document a link opens. */
export interface OpenedDocument {
  kind: DocumentKind;
  slug: string;
  /** The entry's id; a Single has none. */
  id?: string;
}

/**
 * What the rule reads of a collection: its fields (either shape the admin is
 * given them in), the field it titles entries by and its declared `opensIn`.
 */
export interface OpenableCollection {
  fields?: readonly object[];
  schemaDefinition?: { fields?: readonly object[] };
  admin?: { useAsTitle?: string; opensIn?: string };
}

/** Who is opening the document, and in which language. */
export interface OpenRequest {
  /** Whether the reader may update the document. */
  canUpdate: boolean;
  /** The language asked for, when one is. */
  locale?: string;
  /** The site's default language, when the site has languages. */
  defaultLocale?: string;
}

/** A top-level field the rule names: its declaration and its path. */
export interface MainField {
  field: object;
  path: string;
}

/** Where the rule opens an entry: the form, or a view on an optional field. */
type Destination = { view?: undefined } | { view: string; field?: string };

function fieldsOf(collection: OpenableCollection): readonly object[] {
  return collection.fields ?? collection.schemaDefinition?.fields ?? [];
}

function isHidden(field: object): boolean {
  if (!("admin" in field)) return false;
  const admin = field.admin;
  return (
    typeof admin === "object" &&
    admin !== null &&
    "hidden" in admin &&
    admin.hidden === true
  );
}

function typeOf(field: object): string | undefined {
  return "type" in field && typeof field.type === "string"
    ? field.type
    : undefined;
}

/**
 * The top-level fields as the form lays them out, reading into unnamed
 * groups, with the hidden ones (or those inside a hidden group) left out.
 */
function shownTopLevelFields(collection: OpenableCollection): MainField[] {
  return addressableFieldsWithin(fieldsOf(collection))
    .filter(({ field, within }) => !isHidden(field) && !within.some(isHidden))
    .map(({ field, path }) => ({ field, path }));
}

/**
 * The collection's main field: the first top-level field, reading into
 * unnamed groups, that is not hidden, not the one it titles entries by and
 * not `slug`.
 */
export function mainFieldOf(
  collection: OpenableCollection
): MainField | undefined {
  const titleField = collection.admin?.useAsTitle ?? "title";
  return shownTopLevelFields(collection).find(
    ({ path }) => path !== titleField && path !== "slug"
  );
}

/** The published view at `path` on a collection: its own first, else a field type's. */
function viewAt(
  views: readonly RegisteredDocumentView[],
  slug: string,
  path: string
): RegisteredDocumentView | undefined {
  return (
    views.find(
      view => "slug" in view && view.slug === slug && view.path === path
    ) ?? views.find(view => "fieldType" in view && view.path === path)
  );
}

/** The published view asking to open first for `fieldType`; boot allows one. */
function viewOpeningFirstFor(
  views: readonly RegisteredDocumentView[],
  fieldType: string
): RegisteredDocumentView | undefined {
  return views.find(
    view =>
      "fieldType" in view &&
      view.fieldType === fieldType &&
      view.opensFirst === "mainField"
  );
}

/** Where a declared `opensIn` opens the entry, or the form when it can't. */
function declaredDestination(
  slug: string,
  collection: OpenableCollection,
  opensIn: string,
  views: readonly RegisteredDocumentView[]
): Destination {
  if (opensIn === FORM) return {};
  const view = viewAt(views, slug, opensIn);
  if (view === undefined) return {};
  if (!("fieldType" in view)) return { view: view.path };
  return fieldTypeDestination(collection, view);
}

/** A field-type view on the collection's first top-level field of its type. */
function fieldTypeDestination(
  collection: OpenableCollection,
  view: RegisteredDocumentView
): Destination {
  if (
    !("fieldType" in view) ||
    !documentViewApplies(view, fieldsOf(collection))
  ) {
    return {};
  }
  const field = shownTopLevelFields(collection).find(
    candidate => typeOf(candidate.field) === view.fieldType
  );
  return field === undefined ? {} : { view: view.path, field: field.path };
}

/** Where a collection's entries open by the rule, before the fallbacks. */
function ruleDestination(
  slug: string,
  collection: OpenableCollection,
  views: readonly RegisteredDocumentView[]
): Destination {
  const opensIn = collection.admin?.opensIn;
  if (typeof opensIn === "string") {
    return declaredDestination(slug, collection, opensIn, views);
  }
  const main = mainFieldOf(collection);
  const type = main === undefined ? undefined : typeOf(main.field);
  const view =
    type === undefined ? undefined : viewOpeningFirstFor(views, type);
  if (main === undefined || view === undefined) return {};
  return { view: view.path, field: main.path };
}

/** A language other than the site's default, which only the form edits. */
function otherLanguage(request: OpenRequest): boolean {
  return (
    request.locale !== undefined &&
    request.locale !== "" &&
    request.locale !== request.defaultLocale
  );
}

function withLocale(path: string, locale: string | undefined): string {
  return locale === undefined || locale === ""
    ? path
    : `${path}?${new URLSearchParams({ [LOCALE_PARAM]: locale }).toString()}`;
}

/**
 * The address a link to `document` opens, by the rule above. `collection` is
 * the collection as the admin has it, or `undefined` while it is not known,
 * which opens the form; `views` are the document views the admin's metadata
 * publishes.
 */
export function documentAddress(
  document: OpenedDocument,
  collection: OpenableCollection | undefined,
  request: OpenRequest,
  views: readonly RegisteredDocumentView[]
): string {
  if (document.kind === "single" || document.id === undefined) {
    return withLocale(
      buildRoute(ROUTES.SINGLE_EDIT, { slug: document.slug }),
      request.locale
    );
  }
  const form = buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
    slug: document.slug,
    id: document.id,
  });
  if (
    collection === undefined ||
    !request.canUpdate ||
    otherLanguage(request)
  ) {
    return withLocale(form, request.locale);
  }
  const destination = ruleDestination(document.slug, collection, views);
  if (destination.view === undefined) return withLocale(form, request.locale);
  const address = buildRoute(ROUTES.COLLECTION_ENTRY_VIEW, {
    slug: document.slug,
    id: document.id,
    view: destination.view,
  });
  return destination.field === undefined
    ? address
    : `${address}?${new URLSearchParams({ field: destination.field }).toString()}`;
}

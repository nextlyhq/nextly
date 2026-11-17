/**
 * Where a link meant to open a document goes: the one rule every such link in
 * the admin uses (a list row, a dashboard card's row, the sidebar's Singles),
 * so the same click always opens the same place, whoever made the link.
 *
 * For a collection's entry, or a Single:
 *
 * 1. Its `admin.opensIn`, when it declares one: the form, or a document view
 *    it has.
 * 2. Else the view that asks to open first (`opensFirst: "mainField"`) for
 *    the field type of its main field.
 * 3. Else the form.
 *
 * Then the form, whatever those say, for a reader who may not update the
 * document (a view edits it) and for a document asked for in a language other
 * than the default (a view edits the default language). A view that is not
 * published, because its plugin is off or gone, leaves the form too.
 *
 * A Single follows the same rule as a collection of the same shape, so a
 * Homepage whose main field is a page layout opens where a page does. A view
 * declared on a slug (`views[slug]`) is a collection's, so it is never a
 * Single's, whatever slug the two share; a view offered on a field type is
 * either's.
 *
 * Read from the collection or Single as it is now, so one made in the Schema
 * Builder follows the rule as its fields change, and from the views the
 * admin's metadata publishes (enabled plugins' only), handed in rather than
 * read from the route registry, which fills in an effect after that metadata
 * renders. Nothing is remembered per person. The form's own address is never
 * changed by any of this.
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
 * What the rule reads of a collection or a Single: its fields (either shape
 * the admin is given them in), the field it titles entries by and its
 * declared `opensIn`.
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
 * The fields the title block draws above the form rather than in it: `title`
 * and `slug`, which the collections list puts first on a collection that
 * does not declare them, and the field the collection titles entries by.
 */
function titleFields(collection: OpenableCollection): ReadonlySet<string> {
  const titled = collection.admin?.useAsTitle;
  return new Set(["title", "slug", ...(titled === undefined ? [] : [titled])]);
}

/**
 * The collection's main field: the first top-level field, reading into
 * unnamed groups, that is not hidden, not the title (the field it titles
 * entries by, or `title`) and not `slug`.
 */
export function mainFieldOf(
  collection: OpenableCollection
): MainField | undefined {
  const skipped = titleFields(collection);
  return shownTopLevelFields(collection).find(({ path }) => !skipped.has(path));
}

/** Which document the rule is read for: its kind and slug. */
type RuleDocument = Pick<OpenedDocument, "kind" | "slug">;

/**
 * The published view at `path` on a document: a collection's own first, else
 * a field type's. A view declared on a slug is a collection's, so a Single
 * sharing that slug never has it, as `matchDocumentView` routes it.
 */
function viewAt(
  views: readonly RegisteredDocumentView[],
  document: RuleDocument,
  path: string
): RegisteredDocumentView | undefined {
  const own =
    document.kind === "collection"
      ? views.find(
          view =>
            "slug" in view && view.slug === document.slug && view.path === path
        )
      : undefined;
  return own ?? views.find(view => "fieldType" in view && view.path === path);
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

/** Where a declared `opensIn` opens the document, or the form when it can't. */
function declaredDestination(
  document: RuleDocument,
  collection: OpenableCollection,
  opensIn: string,
  views: readonly RegisteredDocumentView[]
): Destination {
  if (opensIn === FORM) return {};
  const view = viewAt(views, document, opensIn);
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

/** Where a collection's entries, or a Single, open by the rule, before the fallbacks. */
function ruleDestination(
  document: RuleDocument,
  collection: OpenableCollection,
  views: readonly RegisteredDocumentView[]
): Destination {
  const opensIn = collection.admin?.opensIn;
  if (typeof opensIn === "string") {
    return declaredDestination(document, collection, opensIn, views);
  }
  const main = mainFieldOf(collection);
  const type = main === undefined ? undefined : typeOf(main.field);
  const view =
    type === undefined ? undefined : viewOpeningFirstFor(views, type);
  if (main === undefined || view === undefined) return {};
  return { view: view.path, field: main.path };
}

/**
 * The document view a collection's entries, or a Single, open in by the rule
 * above, before the fallbacks for one reader or one language, or `undefined`
 * where they open as the form. The same reading every link uses, so a view
 * that asks whether it is where its document opens gets the answer a list
 * row or the sidebar acts on.
 */
export function documentOpeningView(
  document: RuleDocument,
  collection: OpenableCollection,
  views: readonly RegisteredDocumentView[]
): RegisteredDocumentView | undefined {
  const { view } = ruleDestination(document, collection, views);
  return view === undefined ? undefined : viewAt(views, document, view);
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
 * The form's address for a document, in the language asked for: a
 * collection's entry by its id, else the Single's by its slug.
 */
function formAddress(document: OpenedDocument, locale?: string): string {
  const { slug, id } = document;
  return withLocale(
    document.kind === "collection" && id !== undefined
      ? buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, { slug, id })
      : buildRoute(ROUTES.SINGLE_EDIT, { slug }),
    locale
  );
}

/**
 * A view's address for a document, naming the field it edits where it has
 * one: under a collection's entry, or under the Single, which has one
 * document and so no id.
 */
function viewAddress(
  document: ViewableDocument["document"],
  destination: { view: string; field?: string }
): string {
  const { view } = destination;
  const address =
    document.kind === "collection"
      ? buildRoute(ROUTES.COLLECTION_ENTRY_VIEW, {
          slug: document.slug,
          id: document.id,
          view,
        })
      : buildRoute(ROUTES.SINGLE_VIEW, { slug: document.slug, view });
  return destination.field === undefined
    ? address
    : `${address}?${new URLSearchParams({ field: destination.field }).toString()}`;
}

/**
 * The collection or Single, when a document of it may be opened in a view at
 * all: one that is known, for a reader who may update it (a view edits it),
 * asked for in the default language (a view edits that one). The one
 * statement of those conditions, which where a document opens, its other ways
 * in and the list's create dialog all read.
 */
function viewableCollection(
  collection: OpenableCollection | undefined,
  request: OpenRequest
): OpenableCollection | undefined {
  return collection === undefined ||
    !request.canUpdate ||
    otherLanguage(request)
    ? undefined
    : collection;
}

/**
 * A document that may be opened in a view, with its collection or Single: a
 * collection's entry by its id, or a Single, which has one document.
 */
interface ViewableDocument {
  document:
    | { kind: "collection"; slug: string; id: string }
    | { kind: "single"; slug: string };
  collection: OpenableCollection;
}

/**
 * The document, when it may be opened in a view at all
 * (`viewableCollection`): a Single, or a collection's saved entry.
 */
function viewableDocument(
  document: OpenedDocument,
  collection: OpenableCollection | undefined,
  request: OpenRequest
): ViewableDocument | undefined {
  const viewable = viewableCollection(collection, request);
  if (viewable === undefined) return undefined;
  if (document.kind === "single") {
    return {
      document: { kind: "single", slug: document.slug },
      collection: viewable,
    };
  }
  return document.id === undefined
    ? undefined
    : {
        document: { kind: "collection", slug: document.slug, id: document.id },
        collection: viewable,
      };
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
  const viewable = viewableDocument(document, collection, request);
  const destination =
    viewable === undefined
      ? {}
      : ruleDestination(viewable.document, viewable.collection, views);
  return viewable === undefined || destination.view === undefined
    ? formAddress(document, request.locale)
    : viewAddress(viewable.document, destination);
}

/**
 * One other way into a document: the words it is offered by, where it goes,
 * and whether that is the form or one of the document's views.
 */
export interface WayIn {
  label: string;
  address: string;
  opens: "form" | "view";
}

/**
 * The admin's own words for the way into the form from a list row whose
 * entries open in a view. A view's words come from the view.
 */
const EDIT_DETAILS = "Edit details";

/**
 * The words a way into `view` is offered by: its `openLabel`, else "Open in"
 * its label. A view with neither has no words to be offered by.
 */
function wordsFor(view: RegisteredDocumentView): string | undefined {
  if (view.openLabel !== undefined) return view.openLabel;
  return view.label === undefined || view.label === ""
    ? undefined
    : `Open in ${view.label}`;
}

/**
 * Where `view` opens `document`, or `undefined` where it does not apply. A
 * view declared on a slug is a collection's own, never a Single's.
 */
function viewDestination(
  document: RuleDocument,
  collection: OpenableCollection,
  view: RegisteredDocumentView
): { view: string; field?: string } | undefined {
  if ("slug" in view) {
    return document.kind === "collection" && view.slug === document.slug
      ? { view: view.path }
      : undefined;
  }
  if (!documentViewApplies(view, fieldsOf(collection))) return undefined;
  const destination = fieldTypeDestination(collection, view);
  if (destination.view !== undefined) return destination;
  // A top-level field of the type that the rule passed over is hidden, and a
  // hidden field is offered no way in. A field the rule cannot name at all,
  // one inside a named group, is left to the view, which resolves the field
  // it edits from an address without one, as for any such address.
  const atTopLevel = addressableFieldsWithin(fieldsOf(collection)).some(
    ({ field }) => typeOf(field) === view.fieldType
  );
  return atTopLevel ? undefined : { view: view.path };
}

/** Each published view applying to the document, as a way in, by its path. */
function waysIntoViews(
  viewable: ViewableDocument,
  views: readonly RegisteredDocumentView[]
): (WayIn & { view: string })[] {
  return views.flatMap(view => {
    const label = wordsFor(view);
    const destination = viewDestination(
      viewable.document,
      viewable.collection,
      view
    );
    if (label === undefined || destination === undefined) return [];
    return [
      {
        view: destination.view,
        label,
        address: viewAddress(viewable.document, destination),
        opens: "view" as const,
      },
    ];
  });
}

/** A way in without the view it leads to. */
function asWayIn({ label, address, opens }: WayIn): WayIn {
  return { label, address, opens };
}

/**
 * The views `document` may be opened in, as the form offers them (beside
 * History): each published view applying to it, worded by the view, at the
 * address the rule above gives a view. None for a reader who may not update
 * the document or in a language other than the default, as those open as the
 * form.
 */
export function viewsToOpenIn(
  document: OpenedDocument,
  collection: OpenableCollection | undefined,
  request: OpenRequest,
  views: readonly RegisteredDocumentView[]
): WayIn[] {
  const viewable = viewableDocument(document, collection, request);
  return viewable === undefined
    ? []
    : waysIntoViews(viewable, views).map(asWayIn);
}

/**
 * The other ways into `document` a list row offers beside its own link: the
 * form ("Edit details") where the rule opens the entry in a view, with any
 * other view; else each view the entry may be opened in.
 */
export function rowWaysIn(
  document: OpenedDocument,
  collection: OpenableCollection | undefined,
  request: OpenRequest,
  views: readonly RegisteredDocumentView[]
): WayIn[] {
  const viewable = viewableDocument(document, collection, request);
  if (viewable === undefined) return [];
  const opened = ruleDestination(
    viewable.document,
    viewable.collection,
    views
  ).view;
  const others = waysIntoViews(viewable, views)
    .filter(way => way.view !== opened)
    .map(asWayIn);
  if (opened === undefined) return others;
  return [
    {
      label: EDIT_DETAILS,
      address: formAddress(document, request.locale),
      opens: "form",
    },
    ...others,
  ];
}

/**
 * The create dialog (`createDialog`) "+ New" opens on `document`'s collection:
 * the one the view its entries open in declares, by the rule above, so the
 * dialog belongs to the view where its new entry will open. None where the
 * entries open as the form, for a reader who may not update them (a view
 * edits them) or on a Single.
 */
export function createDialogOf(
  document: OpenedDocument,
  collection: OpenableCollection | undefined,
  request: OpenRequest,
  views: readonly RegisteredDocumentView[]
): string | undefined {
  // A Single has one document, made with it, so "+ New" never applies.
  if (document.kind !== "collection") return undefined;
  const viewable = viewableCollection(collection, request);
  if (viewable === undefined) return undefined;
  // The view the entries open in, read as every other reading of it is.
  return documentOpeningView(document, viewable, views)?.createDialog;
}

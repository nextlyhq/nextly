/**
 * Where the Page Builder opens for one field: the document view the plugin
 * contributes on its field type, at the document's own address, naming the
 * field so a document with several opens the one the author chose.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/builder-address
 */
import type { Binding } from "@nextlyhq/blocks-engine";
import type {
  DocumentIdentity,
  DocumentLocale,
  FieldAddress,
} from "@nextlyhq/plugin-sdk/admin";

import { BUILDER_VIEW_PATH } from "../../builder-view";

/**
 * The builder's address, with what to say about where it leads; or that the
 * entry has never been saved, so it has no address until it is; or why this
 * field has none.
 *
 * The unsaved entry is its own answer rather than a sentence, because it has
 * a remedy the card offers in its place: saving the draft and then opening
 * the builder, which needs the saved id.
 */
export type BuilderAddress =
  | { href: string; note?: string }
  | { unsaved: true }
  | { unavailable: string };

/**
 * Said beside the way in while another language is on screen. The builder
 * edits the default language only, so the link opens that one whatever the
 * edit screen shows, and the card's preview is showing the other language.
 */
const DEFAULT_LANGUAGE_NOTE =
  "Opens the default language, the one the Page Builder edits.";

/**
 * Whether the edit screen shows a language other than the default, the one the
 * Page Builder edits.
 *
 * One answer for the two things that follow from it: the way in says where it
 * leads, and the entry screen offers no way into a single section, since that
 * language's document is not the one the builder opens and its sections need
 * not be the same.
 */
export function showsAnotherLanguage(
  locale?: Pick<DocumentLocale, "documentLocalized" | "isDefaultLocale"> | null
): boolean {
  return locale?.documentLocalized === true && !locale.isDefaultLocale;
}

/**
 * The builder's address for `fieldName` on the document the form holds.
 *
 * `fieldName` is the field's address from the document's root: `layout` at
 * the top level, `hero.body` inside a named group, and inside a repeater's
 * row the row's saved id in place of its position (`sections.<rowId>.body`),
 * which `useFieldAddress` gives a field and the view resolves by. A position
 * names another row once the rows are reordered, so it is never put here: the
 * view refuses an address that names a row by one.
 *
 * Withheld where there is no address to open: outside a document, with the
 * sentence the card shows, and on an entry that has never been saved.
 */
export function builderAddress(
  identity: DocumentIdentity | null,
  fieldName: string,
  locale?: Pick<DocumentLocale, "documentLocalized" | "isDefaultLocale"> | null
): BuilderAddress {
  const elsewhere = showsAnotherLanguage(locale)
    ? { note: DEFAULT_LANGUAGE_NOTE }
    : {};
  if (identity === null) {
    return { unavailable: "The Page Builder opens from a saved page." };
  }
  const query = `?field=${encodeURIComponent(fieldName)}`;
  if (identity.kind === "single") {
    return {
      href: `${singleBuilderPath(identity.slug)}${query}`,
      ...elsewhere,
    };
  }
  if (identity.documentId === undefined) return { unsaved: true };
  return {
    href: `${documentBuilderPath(identity.slug, identity.documentId)}${query}`,
    ...elsewhere,
  };
}

/**
 * Why a field inside a repeater's row has no way in yet, as the card says it
 * beneath the same button, drawn disabled.
 */
const ROW_UNAVAILABLE: Record<
  Extract<FieldAddress, { unavailable: unknown }>["unavailable"],
  string
> = {
  // A row added since the last save has an id only in this form; the
  // builder's address must still find it after a reload.
  unsavedRow: "Save the entry once to design this row.",
  ownIds:
    "This repeater's rows set their own id field, so a row has no saved identity to open in the Page Builder.",
  unaddressable:
    "The Page Builder can't open this field: the row it sits in has no address it can open.",
};

/**
 * Why a row's field has no way in while the form shows another language. The
 * builder edits the default language's document, and a translated repeater
 * keeps its own rows, with their own ids, in each language: an address read
 * from this language's rows would name a row the default language may not
 * have, which the builder refuses as gone, or one it has under another
 * content. So the way in is withheld rather than offered to fail.
 */
const ROW_IN_ANOTHER_LANGUAGE =
  "Switch to the default language to design this row: the Page Builder edits the default language's rows.";

/**
 * The builder's address for a field, from the address its form gives it
 * (`useFieldAddress`): the same as {@link builderAddress}, or, for a field in
 * a repeater's row that has no address yet, or that the form shows in another
 * language, why. A document that cannot open the builder at all is said
 * first, since saving it is the first step either way.
 */
export function fieldBuilderAddress(
  identity: DocumentIdentity | null,
  field: FieldAddress,
  locale?: Pick<DocumentLocale, "documentLocalized" | "isDefaultLocale"> | null
): BuilderAddress {
  const document = builderAddress(identity, "", locale);
  if ("address" in field) {
    // Whether the field is in a row is said by the form, never inferred.
    if (field.throughRow !== true || !showsAnotherLanguage(locale)) {
      return builderAddress(identity, field.address, locale);
    }
    if (!("href" in document)) return document;
    return { unavailable: ROW_IN_ANOTHER_LANGUAGE };
  }
  if (!("href" in document)) return document;
  return { unavailable: ROW_UNAVAILABLE[field.unavailable] };
}

/**
 * The Page Builder view of a Single, naming no field, as
 * {@link documentBuilderPath} is for a collection's document: a Single is
 * addressed by its slug alone, having one document.
 */
export function singleBuilderPath(slug: string): string {
  return `/admin/singles/${encodeURIComponent(slug)}/${BUILDER_VIEW_PATH}`;
}

/**
 * The Page Builder view of a document in a collection, naming no field: the
 * admin opens the document's one blocks field, or asks which where it has
 * several. The path every address of a collection document's view starts
 * from.
 */
export function documentBuilderPath(collection: string, id: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/${BUILDER_VIEW_PATH}`;
}

/**
 * The admin's list of `collection`'s entries, as its own route table spells
 * it (`/admin/collections/<slug>`).
 */
export function collectionListPath(collection: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}`;
}

/**
 * The admin's screen for a new entry of `collection`, as its own route
 * table spells it (`/admin/collections/<slug>/create`): where the template
 * preview's New opens.
 */
export function entryCreatePath(collection: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}/create`;
}

/**
 * The admin's edit screen for entry `id` of `collection`, as its own route
 * table spells it (`/admin/collections/<slug>/<id>`): where an Entry content
 * block's Open opens the entry whose content it draws.
 */
export function entryEditPath(collection: string, id: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
}

/** An edit screen's path, opened in `locale` where one is given. */
function inLanguage(path: string, locale: string | undefined): string {
  return locale === undefined || locale === ""
    ? path
    : `${path}?${new URLSearchParams({ locale }).toString()}`;
}

/**
 * The admin's edit screen for the Single `slug`, as its own route table
 * spells it (`/admin/singles/<slug>`).
 */
export function singleEditPath(slug: string): string {
  return `/admin/singles/${encodeURIComponent(slug)}`;
}

/**
 * The admin's general settings, as its own route table spells it
 * (`/admin/settings`): where the site settings a binding reads (its name,
 * address, logo and time zone) are edited.
 */
const SITE_SETTINGS_PATH = "/admin/settings";

/**
 * Where the source a binding reads is edited: the entry's edit screen (the
 * page's own, or the entry a template is previewed with), the Single's, or
 * the site settings. `undefined` where there is no one screen: a list's item,
 * and an entry not saved yet.
 *
 * An entry's and a Single's screens open in the language being edited, the
 * one the picker previewed the field in, named as the admin's own entry
 * links name it (`?locale=`); none for the default, which is what a screen
 * opens without one. The site settings have one language.
 *
 * @param entry - the entry the editor's bindings read, as the picker lists it
 * @param locale - the language being edited, `undefined` for the default
 */
export function bindingSourcePath(
  binding: Binding,
  entry: DocumentIdentity | null,
  locale?: string
): string | undefined {
  switch (binding.source ?? "entry") {
    case "entry":
      if (entry === null) return undefined;
      if (entry.kind === "single") {
        return inLanguage(singleEditPath(entry.slug), locale);
      }
      return entry.documentId === undefined
        ? undefined
        : inLanguage(entryEditPath(entry.slug, entry.documentId), locale);
    case "single":
      return "sourceKey" in binding && typeof binding.sourceKey === "string"
        ? inLanguage(singleEditPath(binding.sourceKey), locale)
        : undefined;
    case "site":
      return SITE_SETTINGS_PATH;
    default:
      return undefined;
  }
}

/**
 * The query key naming the section the builder opens at.
 *
 * The admin keeps the same key in its list of a view's own address keys, so
 * moving between the edit form and the builder at a section stays on the one
 * document rather than counting as leaving it.
 */
const SECTION_PARAM = "section";

/**
 * The builder's address `href`, opened at the section `sectionId`.
 *
 * Built on the address `builderAddress` gave rather than beside it, so the
 * field, the document and the language it names are the ones the plain way in
 * names. A section already named is replaced: an address names one place.
 */
export function sectionAddress(href: string, sectionId: string): string {
  const [path = "", query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(SECTION_PARAM, sectionId);
  return `${path}?${params.toString()}`;
}

/** The same address naming no section, for a return that opens at the top. */
export function addressWithoutSection(href: string): string {
  const [path = "", query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete(SECTION_PARAM);
  const rest = params.toString();
  return rest === "" ? path : `${path}?${rest}`;
}

/**
 * The query key naming a block, at any depth, the builder opens at: what a
 * report of a page's broken bindings links each binding's block by.
 */
const BLOCK_PARAM = "block";

/** The builder's address `href`, opened at the block `blockId`. */
export function blockAddress(href: string, blockId: string): string {
  const [path = "", query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set(BLOCK_PARAM, blockId);
  return `${path}?${params.toString()}`;
}

/** Where an address opens the builder: a section of the page, or a block. */
export interface OpenAt {
  /** A top-level block, as the entry screen links each section. */
  readonly sectionId?: string;
  /** A block at any depth, as the bindings report links each binding. */
  readonly blockId?: string;
}

/**
 * Where an address opens the builder: the section it names, else the block;
 * neither where it names neither.
 */
export function openAtFromSearch(search: string): OpenAt {
  const section = sectionFromSearch(search);
  if (section !== undefined) return { sectionId: section };
  const block = new URLSearchParams(search).get(BLOCK_PARAM);
  return block === null || block === "" ? {} : { blockId: block };
}

/**
 * The section an address's query names, or `undefined` where it names none.
 *
 * An empty value names none: there is no block with an empty id to open at.
 */
export function sectionFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get(SECTION_PARAM);
  return value === null || value === "" ? undefined : value;
}

/**
 * A way into the builder an author asked for on an entry never saved, held
 * until that entry's first save has landed and its form is drawn again at
 * the entry's own address, whose field then opens it.
 *
 * Held here rather than run where it was asked: the create screen moves to
 * the entry's address once the save lands, so the card that asked is gone by
 * then, and a move to the builder made beside that one would race it. The
 * field drawn at the new address claims it, by the entry's id and the field's
 * form path, which a first save leaves where it was.
 */
interface OpenAfterSave {
  readonly collection: string;
  readonly id: string;
  readonly field: string;
  /** When the request lapses, in ms since the epoch. */
  readonly until: number;
}

let openAfterSave: OpenAfterSave | null = null;

/**
 * How long a request waits for the entry's form to be drawn again. Long
 * enough for a slow read of the new entry, short enough that a form opened
 * much later never moves to the builder on its own.
 */
const OPEN_AFTER_SAVE_MS = 60_000;

/**
 * Ask for the builder to open on `field` of the entry `id` just created in
 * `collection`, once its form is drawn. One request at a time: a later one
 * replaces it.
 */
export function openBuilderAfterSave(
  collection: string,
  id: string,
  field: string,
  now: number = Date.now()
): void {
  openAfterSave = { collection, id, field, until: now + OPEN_AFTER_SAVE_MS };
}

/**
 * Whether the builder was asked to open on `field` of the document the form
 * now holds; true at most once per request, which this ends. A lapsed
 * request is ended unanswered.
 */
export function claimOpenAfterSave(
  identity: DocumentIdentity | null,
  field: string,
  now: number = Date.now()
): boolean {
  const asked = openAfterSave;
  if (asked === null) return false;
  if (now > asked.until) {
    openAfterSave = null;
    return false;
  }
  if (
    identity?.kind !== "collection" ||
    identity.slug !== asked.collection ||
    identity.documentId !== asked.id ||
    field !== asked.field
  ) {
    return false;
  }
  openAfterSave = null;
  return true;
}

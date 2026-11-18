/**
 * A shared style's usage with what the editor has open accounted for apart:
 * the route names what the open field's document contributes as saved, in
 * the parts the editor needs to count that field from its live copy instead,
 * so an unsaved edit is counted at once and nothing is counted twice.
 *
 * @module shared-style-usage-here
 */
import {
  SHARED_STYLE_HERE_FIELD_PARAM,
  SHARED_STYLE_HERE_LOCALE_PARAM,
  SHARED_STYLE_HERE_PARAM,
  SHARED_STYLE_HERE_VARIANT_PARAM,
  type SharedStyleUsage,
  type SharedStyleUsageHere,
  type SharedStyleUsageHereParts,
  type SharedStyleUsageKind,
} from "./library-contract";
import {
  blockCountOf,
  copiesOf,
  copyBlocks,
  documentBlocks,
  documentCountOf,
  type BlockShare,
  type DocumentsUsing,
  type StoredCopy,
} from "./usage-count";

/**
 * What the editor has open, from the usage read's parameters, or `undefined`
 * when they name no document, no field or no stored form. The document is
 * `here=<collection>/<id>`, split at the first `/` since a collection slug
 * holds none, or `here=single:<slug>`.
 */
export function usageHereOf(url: string): SharedStyleUsageHere | undefined {
  const params = new URL(url).searchParams;
  const document = documentNamed(params.get(SHARED_STYLE_HERE_PARAM));
  const field = params.get(SHARED_STYLE_HERE_FIELD_PARAM);
  const variant = params.get(SHARED_STYLE_HERE_VARIANT_PARAM);
  if (document === undefined || field === null || field === "") {
    return undefined;
  }
  if (variant !== "published" && variant !== "draft") return undefined;
  const locale = params.get(SHARED_STYLE_HERE_LOCALE_PARAM);
  return {
    document,
    field,
    ...(locale === null || locale === "" ? {} : { locale }),
    variant,
  };
}

/** How a Single is named in the parameter, before its slug. */
const SINGLE_PREFIX = "single:";

function documentNamed(
  value: string | null
): SharedStyleUsageHere["document"] | undefined {
  if (value === null) return undefined;
  if (value.startsWith(SINGLE_PREFIX)) {
    const single = value.slice(SINGLE_PREFIX.length);
    return single === "" ? undefined : { single };
  }
  const at = value.indexOf("/");
  if (at <= 0 || at === value.length - 1) return undefined;
  return { collection: value.slice(0, at), id: value.slice(at + 1) };
}

/**
 * How the route learns whether the caller may read the open document, and
 * which language a read with none names: the where-used list's own readers,
 * which read as the caller.
 */
export interface UsageHereReaders {
  /** The documents of one collection the caller may read, or `null` for none. */
  readonly named: (
    collection: string,
    ids: readonly string[]
  ) => Promise<readonly { readonly id: string }[] | null>;
  /** A Single's name when the caller may read it, else `null`. */
  readonly single: (slug: string) => Promise<string | null>;
  /** The site's default language by code, or empty where it keeps none. */
  readonly defaultLocale: () => string;
}

/** What the editor has open, with its language resolved to the index's code. */
export interface ResolvedHere {
  readonly document: SharedStyleUsageHere["document"];
  readonly field: string;
  /** The language by code, or empty on a site that keeps no languages. */
  readonly locale: string;
  readonly variant: SharedStyleUsageHere["variant"];
}

/**
 * What the editor has open, when the read names it and the caller may read
 * that document; `undefined` otherwise. Checked before anything about the
 * document is read from the index, which is read as the system: a style
 * reader who may not read a page learns nothing of that page from its name.
 */
export async function readableHere(
  url: string,
  readers: UsageHereReaders
): Promise<ResolvedHere | undefined> {
  const here = usageHereOf(url);
  if (here === undefined) return undefined;
  const { document } = here;
  const readable =
    "single" in document
      ? (await readers.single(document.single)) !== null
      : ((await readers.named(document.collection, [document.id])) ?? []).some(
          row => row.id === document.id
        );
  if (!readable) return undefined;
  return {
    document,
    field: here.field,
    locale: here.locale ?? readers.defaultLocale(),
    variant: here.variant,
  };
}

/**
 * One listing as a usage: its documents, the same by kind, and the blocks on
 * them. A floor when the listing is, or when any document's blocks are not
 * counted yet.
 */
export function usageOf(
  found: DocumentsUsing,
  kindOf: (collection: string) => SharedStyleUsageKind,
  here?: ResolvedHere
): SharedStyleUsage {
  const byKind: Record<SharedStyleUsageKind, number> = {
    pages: 0,
    components: 0,
    patterns: 0,
    layouts: 0,
  };
  for (const entry of found.collections) {
    byKind[kindOf(entry.collection)] += entry.documents.length;
  }
  const blocks = blockCountOf(found);
  return {
    documents: documentCountOf(found),
    byKind,
    ...(blocks === undefined ? {} : { blocks: blocks.blocks }),
    ...(here === undefined || blocks === undefined
      ? {}
      : { here: hereShare(found, kindOf, here) }),
    complete: found.complete && (blocks?.complete ?? true),
  };
}

/** The open document's saved parts: all 0 when it holds none. */
function hereShare(
  found: DocumentsUsing,
  kindOf: (collection: string) => SharedStyleUsageKind,
  here: ResolvedHere
): SharedStyleUsageHereParts {
  const { document } = here;
  const single = "single" in document;
  const collection = single ? document.single : document.collection;
  return {
    ...hereParts(sharesOf(found, document) ?? [], here),
    kind: kindOf(collection),
  };
}

/** The open document's rows in a listing, or `undefined` when it is not listed. */
function sharesOf(
  found: DocumentsUsing,
  document: SharedStyleUsageHere["document"]
): readonly BlockShare[] | undefined {
  const single = "single" in document;
  const collection = single ? document.single : document.collection;
  for (const entry of found.collections) {
    if (entry.collection !== collection) continue;
    if ((entry.single === true) !== single) continue;
    // A Single's one document is listed with no id.
    const at = single ? 0 : entry.documents.indexOf(document.id);
    const shares = entry.shares?.[at];
    if (shares !== undefined) return shares;
  }
  return undefined;
}

/**
 * One document's saved blocks in the parts the editor replaces with its live
 * field ({@link SharedStyleUsageHereParts}). The open field's rows are set
 * aside in the copies it is part of: the language being edited, or every
 * language of its form where the field is one they share. Its rows in the
 * document's other forms stay, since the editor changes none of those.
 */
export function hereParts(
  shares: readonly BlockShare[],
  open: Pick<ResolvedHere, "field" | "locale" | "variant">
): Omit<SharedStyleUsageHereParts, "kind"> {
  const copies = copiesOf(shares);
  const sameForm = copies
    .filter(copy => copy.variant === open.variant)
    .map(copy => copy.locale);
  const fieldRows = shares.filter(
    share => share.field === open.field && share.variant === open.variant
  );
  // A field every language shares is part of each language's copy.
  const shared =
    open.locale === "" || fieldRows.some(share => share.locale === "");
  const edited = shared && sameForm.length > 0 ? sameForm : [open.locale];
  const rest = shares.filter(
    share =>
      !(
        share.field === open.field &&
        share.variant === open.variant &&
        (shared || share.locale === open.locale || share.locale === "")
      )
  );
  const isEdited = (copy: StoredCopy) =>
    copy.variant === open.variant && edited.includes(copy.locale);
  const alongside = largestOf(
    edited.map(locale => copyBlocks(rest, { variant: open.variant, locale }))
  );
  const others = copies.filter(copy => !isEdited(copy));
  return {
    saved: documentBlocks(shares),
    alongside:
      fieldRows.length === 0 &&
      !shared &&
      outgrows(rest, others, open.variant, alongside)
        ? null
        : alongside,
    elsewhere: largestOf(others.map(copy => copyBlocks(rest, copy))),
  };
}

/**
 * Whether a copy of the open form in another language holds more than the
 * edited one. Asked only when the open field has no rows in that form, so
 * the rows cannot say whether it is shared by every language (and its live
 * blocks count in each) or the edited language's own: then the two readings
 * disagree, and the open document's count is not known.
 */
function outgrows(
  rest: readonly BlockShare[],
  others: readonly StoredCopy[],
  variant: string,
  alongside: number | null
): boolean {
  if (alongside === null) return false;
  return others.some(copy => {
    if (copy.variant !== variant) return false;
    const blocks = copyBlocks(rest, copy);
    return blocks === null || blocks > alongside;
  });
}

/** The largest of some counts: `null` when any is unknown, 0 for none. */
function largestOf(counts: readonly (number | null)[]): number | null {
  let largest = 0;
  for (const count of counts) {
    if (count === null) return null;
    largest = Math.max(largest, count);
  }
  return largest;
}

/**
 * What a link to this page will look like when it is shared, approximately.
 *
 * Built from the same answers the published page's metadata is: the SEO
 * fields first, then what the page itself offers (its first heading, prose and
 * image, read by the engine's `deriveSeoFromDocument`, which the published
 * route uses), then the page's title. Approximate, because the site's own
 * metadata callback decides the published tags in the end.
 *
 * @module admin/editor/share-preview
 */
import {
  deriveSeoFromDocument,
  getBlock,
  isConditionGated,
  type BlockDocument,
  type SeoDefinitionSource,
} from "@nextlyhq/blocks-engine";

/** The SEO plugin's fields, as far as the preview reads them. */
export interface ShareSeoFields {
  metaTitle?: unknown;
  metaDescription?: unknown;
  ogImage?: unknown;
}

/** The image a shared link would carry. */
export type ShareImage =
  | { kind: "url"; url: string }
  /** An image from the media library, shown as a stand-in until it is read. */
  | { kind: "media" }
  /**
   * An image written as another site's address. Shown as a stand-in, never
   * fetched: the published page only uses one whose host the site allows, and
   * that list is the server's, so Settings would otherwise contact a host the
   * site refuses and preview an image the live link leaves out.
   */
  | { kind: "remote" };

/** What the preview card shows. */
export interface SharePreview {
  title: string;
  description?: string;
  image?: ShareImage;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Whether a stored string is an address rather than a media library id. */
function isAddress(value: string): boolean {
  return /^(https?:)?\/\//i.test(value) || value.startsWith("/");
}

/** A media value's address, whatever shape the field stored it in. */
/** An image written as an address: this site's own path, or a stand-in. */
function addressImage(address: string): ShareImage {
  return address.startsWith("/") && !address.startsWith("//")
    ? { kind: "url", url: address }
    : { kind: "remote" };
}

function seoImage(value: unknown): ShareImage | undefined {
  const stored = text(value);
  if (stored !== undefined) {
    // An upload field stores the media's id, which is not an image address.
    return isAddress(stored) ? addressImage(stored) : { kind: "media" };
  }
  if (value !== null && typeof value === "object") {
    const nested = text((value as Record<string, unknown>).url);
    return nested === undefined
      ? { kind: "media" }
      : { kind: "url", url: nested };
  }
  return undefined;
}

/**
 * The preview for a page: the SEO fields, then the document, then the title.
 * Only content every visitor sees speaks for the page, as on the published
 * route: a block behind a condition is not read.
 */
export function sharePreview(args: {
  seo: ShareSeoFields | undefined;
  /**
   * The page as the published route reads it (`prepareDocumentForRead`):
   * components resolved, limits applied, placeholders pruned. `null` when
   * nothing on it is readable.
   */
  document: BlockDocument | null;
  pageTitle: string;
  /** The block definitions, by type: the editor's registry unless given. */
  definitions?: SeoDefinitionSource;
}): SharePreview {
  const seo = args.seo ?? {};
  const derived: ReturnType<typeof deriveSeoFromDocument> =
    args.document === null
      ? {}
      : deriveSeoFromDocument(
          args.document,
          args.definitions ?? (type => getBlock(type)),
          node => !isConditionGated(node)
        );
  const title =
    text(seo.metaTitle) ??
    text(derived.title) ??
    text(args.pageTitle) ??
    "Untitled";
  const description = text(seo.metaDescription) ?? text(derived.description);
  const first = derived.image?.[0];
  const image =
    seoImage(seo.ogImage) ??
    (first === undefined
      ? undefined
      : first.kind === "url"
        ? addressImage(first.value)
        : ({ kind: "media" } as const));
  return {
    title,
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image }),
  };
}

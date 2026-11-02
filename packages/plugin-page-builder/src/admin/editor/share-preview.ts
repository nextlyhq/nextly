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
  | { kind: "media" };

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

/** A media value's address, whatever shape the field stored it in. */
function seoImage(value: unknown): ShareImage | undefined {
  const url = text(value);
  if (url !== undefined) return { kind: "url", url };
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
  document: BlockDocument;
  pageTitle: string;
  /** The block definitions, by type: the editor's registry unless given. */
  definitions?: SeoDefinitionSource;
}): SharePreview {
  const seo = args.seo ?? {};
  const derived = deriveSeoFromDocument(
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
        ? ({ kind: "url", url: first.value } as const)
        : ({ kind: "media" } as const));
  return {
    title,
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image }),
  };
}

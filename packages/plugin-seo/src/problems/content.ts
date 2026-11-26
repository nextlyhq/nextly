/**
 * What a page's content shows that the problem list checks: the images it
 * shows, with the alt text each is shown with, and the links in it.
 *
 * Read from the page as stored, at the depth a route reads it, so a media
 * field comes back as the media library's item. Rich text is walked node by
 * node (images, galleries, links and buttons), and so are the blocks, groups
 * and lists holding it. The page's `seo` group is left out: its share image
 * is the card's, not an image the page shows. So is another document read
 * with the page, such as its author: what that holds is that page's content.
 *
 * @module problems/content
 */
import { isFollowedLink } from "@nextlyhq/plugin-sdk/blocks";

import { notAPageAddress } from "../not-found/page-address";
import { isRecord, textOf } from "../plain-values";

import type { ImageFact, LinkFact } from "./page-checks";

/** A page's images and the links in it. */
export interface ContentFacts {
  images: ImageFact[];
  links: LinkFact[];
}

/** Fields that are the page's bookkeeping or its SEO, never its content. */
const NOT_CONTENT = new Set(["id", "seo", "createdAt", "updatedAt"]);

/** How deep into nested content the walk goes before it stops. */
const MAX_DEPTH = 64;

/** The last segment of an address, which names the file. */
function fileName(address: string): string {
  const path = address.split(/[?#]/)[0] ?? address;
  return path.slice(path.lastIndexOf("/") + 1) || address;
}

/** A media library item that is a picture, as a media field reads it. */
function isPicture(value: Record<string, unknown>): boolean {
  return (
    typeof value.mimeType === "string" &&
    value.mimeType.startsWith("image/") &&
    typeof value.url === "string"
  );
}

/**
 * Another document read with the page (a relationship), told by the stamps
 * every stored document carries: what it holds is not this page's content.
 */
function isOtherDocument(value: Record<string, unknown>): boolean {
  return (
    value.id !== undefined &&
    (value.createdAt !== undefined || value.updatedAt !== undefined)
  );
}

/** Reads what one kind of rich text node shows into `facts`. */
type NodeReader = (
  node: Record<string, unknown>,
  field: string,
  facts: ContentFacts
) => void;

/** An image node: its file, and the alt text it is shown with. */
const imageNode: NodeReader = (node, field, facts) => {
  const src = textOf(node.src);
  if (src === undefined) return;
  facts.images.push({
    field,
    name: fileName(src),
    media: false,
    alt: node.altText,
    ...(node.decorative === true ? { decorative: true } : {}),
  });
};

/** A gallery node: each of its images. */
const galleryNode: NodeReader = (node, field, facts) => {
  for (const image of Array.isArray(node.images) ? node.images : []) {
    if (!isRecord(image)) continue;
    const src = textOf(image.src);
    if (src === undefined) continue;
    facts.images.push({
      field,
      name: fileName(src),
      media: false,
      alt: image.alt,
    });
  }
};

/** A link, an automatic link or a button: the address it leads to. */
const linkNode: NodeReader = (node, field, facts) => {
  const url = textOf(node.url);
  if (url !== undefined) facts.links.push({ field, url });
};

/** A group of buttons: each one's address. */
const buttonGroupNode: NodeReader = (node, field, facts) => {
  for (const button of Array.isArray(node.buttons) ? node.buttons : []) {
    if (isRecord(button)) linkNode(button, field, facts);
  }
};

/**
 * A Page Builder image block: its own alt text, where it says one. An
 * explicit empty alt, like the decorative mark, says the image needs none,
 * as the block draws it. One that says nothing about its alt and names a
 * media library item shows that item's own alt text, which is not read
 * here, so it is not judged.
 */
const blockImage: NodeReader = (node, field, facts) => {
  const props = isRecord(node.props) ? node.props : {};
  const src = textOf(props.src);
  const said = typeof props.alt === "string";
  if (src === undefined || (!said && textOf(props.mediaId) !== undefined)) {
    return;
  }
  facts.images.push({
    field,
    name: fileName(src),
    media: false,
    alt: props.alt,
    ...(props.decorative === true || props.alt === ""
      ? { decorative: true }
      : {}),
  });
};

/** A Page Builder button block: the address it leads to. */
const blockButton: NodeReader = (node, field, facts) => {
  const props = isRecord(node.props) ? node.props : {};
  const href = textOf(props.href);
  if (href !== undefined) facts.links.push({ field, url: href });
};

/** What each kind of rich text node and design block the list reads is read by. */
const NODE_READERS: Readonly<Record<string, NodeReader>> = {
  "core/image": blockImage,
  "core/button": blockButton,
  image: imageNode,
  gallery: galleryNode,
  link: linkNode,
  autolink: linkNode,
  "button-link": linkNode,
  "button-group": buttonGroupNode,
};

/**
 * Field names that hold an address: `href`, `url` and `link`, and any name
 * ending in one, such as `linkUrl`, `buttonLink` or `ctaHref`. A card or a
 * button is as often a group of plain text fields as it is a rich text
 * link, and no node reader is for those: the address is in a field of its
 * own, under a name like these.
 */
const ADDRESS_FIELD = /(?:href|url|link)$/i;

/**
 * The path `text` asks for, as a request would arrive: a path on this site
 * without its query or fragment, or the path of a full http(s) address.
 * Nothing for anything else, including a protocol-relative `//host/path`,
 * which a request never arrives as.
 */
function pathAsked(text: string): string | undefined {
  if (text.startsWith("//")) return undefined;
  if (text.startsWith("/")) return text.split(/[?#]/, 1)[0] ?? text;
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text).pathname;
  } catch {
    return undefined;
  }
}

/**
 * The address the field `key` holds in `value`, or nothing where it holds
 * none: the name must be one an address is kept under, and the value must
 * be an address a page is served at. So a field of words, a fragment of the
 * page itself, and a picture's own address are each left alone, judged by
 * the rule the Proxy reads a request by.
 */
function addressIn(key: string, value: unknown): string | undefined {
  if (!ADDRESS_FIELD.test(key)) return undefined;
  const text = textOf(value)?.trim();
  if (text === undefined || text === "") return undefined;
  const asked = pathAsked(text);
  return asked !== undefined && !notAPageAddress(asked) ? text : undefined;
}

/** A media library picture, as a media field reads it. */
function mediaImage(value: Record<string, unknown>, field: string): ImageFact {
  return {
    field,
    name: textOf(value.filename) ?? fileName(String(value.url)),
    media: true,
    alt: value.altText,
  };
}

/** Walks a record: a picture, another document, or content to read and go into. */
function walkRecord(
  value: Record<string, unknown>,
  field: string,
  facts: ContentFacts,
  depth: number
): void {
  if (isPicture(value)) {
    facts.images.push(mediaImage(value, field));
    return;
  }
  if (isOtherDocument(value)) return;
  // An address the author unlinked is words, not a link the page shows:
  // only its words are read, never its stored address.
  if (value.type === "autolink" && !isFollowedLink(value)) {
    walk(value.children, field, facts, depth + 1);
    return;
  }
  if (typeof value.type === "string") {
    NODE_READERS[value.type]?.(value, field, facts);
  }
  for (const [key, child] of Object.entries(value)) {
    const address = addressIn(key, child);
    if (address !== undefined) facts.links.push({ field, url: address });
    walk(child, field, facts, depth + 1);
  }
}

/** Walks `value`, held by the page's `field`, into `facts`. */
function walk(
  value: unknown,
  field: string,
  facts: ContentFacts,
  depth: number
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, field, facts, depth + 1);
  } else if (isRecord(value)) {
    walkRecord(value, field, facts, depth);
  }
}

/**
 * Each link once per field: a node reader and the address field that node
 * keeps its address in both name the same link, and a page linking one
 * address twice links it once.
 */
function eachLinkOnce(links: readonly LinkFact[]): LinkFact[] {
  const seen = new Set<string>();
  return links.filter(link => {
    // Trimmed, because a node reader keeps the address as it is stored and
    // an address field reads it trimmed: the two name one link.
    const key = `${link.field}\u0000${link.url.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The images and links in `document`'s content, by the field holding each. */
export function contentFacts(
  document: Readonly<Record<string, unknown>>
): ContentFacts {
  const facts: ContentFacts = { images: [], links: [] };
  for (const [field, value] of Object.entries(document)) {
    if (NOT_CONTENT.has(field)) continue;
    // A field of the document itself: `walk` goes into arrays and records, so
    // an address kept in a field of its own is read here or nowhere.
    const address = addressIn(field, value);
    if (address !== undefined) facts.links.push({ field, url: address });
    walk(value, field, facts, 0);
  }
  return { images: facts.images, links: eachLinkOnce(facts.links) };
}

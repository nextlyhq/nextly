/**
 * An image's source and its alt text as the inspector edits them: which props
 * make each up, what the stored values mean, and what each choice writes.
 *
 * Each is one question to an author and two props to the block. Where the
 * picture comes from is `mediaId` (a library file) or `src` (an address), and
 * the block draws the library file first and the address only as its
 * fallback. What a screen reader hears is `alt` and `decorative`, which the
 * block reads in that order: decorative wins outright, an alt the page stores
 * (even an empty one) comes next, and the library's alt text applies only
 * when the page stores none. Drawn one row per prop, the panel showed two
 * sources competing and three alt states spread over two controls.
 *
 * Found by prop NAME and type, as the link group is: an embed's `src` is a
 * `url` prop too, and is no image's source without a `mediaId` beside it.
 *
 * Every rule reads what is STORED, never a default: the block's defaults are
 * written when it is placed, not applied when it draws, so a default here
 * would describe a value the page does not hold.
 *
 * Pure, so each rule is tested without a panel.
 *
 * @module image-group
 */
import { isAuthoredText } from "@nextlyhq/blocks-engine";

import type { EditableProp } from "../inspector";

/** Several props written as one edit: a value each, `undefined` to remove it. */
export type ImageChanges = Readonly<Record<string, unknown>>;

/** The two props an image's picture comes from. */
export interface ImageSourceGroup {
  /** The library file's id: drawn first. */
  readonly media: string;
  /** The address: drawn when there is no library file. */
  readonly address: string;
  readonly drawn: ReadonlySet<string>;
}

/** The two props an image's alt text comes from. */
export interface ImageAltGroup {
  readonly alt: string;
  readonly decorative: string;
  /** The library file whose alt text applies when the page stores none. */
  readonly media?: string;
  readonly drawn: ReadonlySet<string>;
}

/** A block's image groups: either, both, or neither. */
export interface ImageGroup {
  readonly source?: ImageSourceGroup;
  readonly alt?: ImageAltGroup;
}

/**
 * The image groups of a block's props, or `undefined` when it declares
 * neither. The source needs `mediaId` as a media prop and `src` as a URL;
 * the alt text needs `alt` as text and `decorative` as a checkbox. A prop
 * that does not join keeps its own row.
 */
export function imageGroupOf(
  props: ReadonlyArray<Pick<EditableProp, "name" | "schema">>
): ImageGroup | undefined {
  const types = new Map(props.map(prop => [prop.name, prop.schema.type]));
  const media = types.get("mediaId") === "media" ? "mediaId" : undefined;
  const source =
    media !== undefined && types.get("src") === "url"
      ? { media, address: "src", drawn: new Set([media, "src"]) }
      : undefined;
  const alt =
    types.get("alt") === "text" && types.get("decorative") === "checkbox"
      ? {
          alt: "alt",
          decorative: "decorative",
          ...(media === undefined ? {} : { media }),
          drawn: new Set(["alt", "decorative"]),
        }
      : undefined;
  if (source === undefined && alt === undefined) return undefined;
  return {
    ...(source === undefined ? {} : { source }),
    ...(alt === undefined ? {} : { alt }),
  };
}

/** A stored string, trimmed, or `undefined` for anything else or nothing. */
function storedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Where an image's picture comes from. */
export type SourceMode = "library" | "url";

/**
 * What the source holds now: a library file (also when an address is stored
 * beside it, which the block draws only as the file's fallback), else an
 * address, else nothing, which is offered as the library.
 */
export function sourceModeOf(
  group: ImageSourceGroup,
  values: Readonly<Record<string, unknown>>
): SourceMode {
  if (storedString(values[group.media]) !== undefined) return "library";
  return storedString(values[group.address]) === undefined ? "library" : "url";
}

/**
 * What an address typed in URL mode writes. A cleared field removes the
 * address. An address clears a stored library file, because the block draws
 * the file first and the address would otherwise do nothing; both go in one
 * edit, so one undo puts the file back.
 */
export function addressChanges(
  group: ImageSourceGroup,
  typed: string,
  values: Readonly<Record<string, unknown>>
): ImageChanges {
  const address = typed.trim();
  if (address === "") return { [group.address]: undefined };
  return {
    [group.address]: address,
    ...(values[group.media] === undefined ? {} : { [group.media]: undefined }),
  };
}

/**
 * What picking a library file writes. A stored address is kept as the file's
 * fallback, since an author may have typed it, unless it is still one the
 * block was placed with (`placedWith`: its example's placeholder, not
 * anyone's address): that one is removed in the same edit, so a fresh image
 * holds the picked file alone.
 */
export function mediaPickChanges(
  group: ImageSourceGroup,
  mediaId: string,
  values: Readonly<Record<string, unknown>>,
  placedWith: ReadonlyArray<Readonly<Record<string, unknown>>>
): ImageChanges {
  const address = values[group.address];
  const placeholder =
    typeof address === "string" &&
    placedWith.some(props => props[group.address] === address);
  return {
    [group.media]: mediaId,
    ...(placeholder ? { [group.address]: undefined } : {}),
  };
}

/** What a screen reader is given for the image. */
export type AltMode = "library" | "custom" | "decorative";

/**
 * Which mode the stored props are in, read as the block reads them:
 * decorative first, then an alt the page stores (an empty one included,
 * which the block draws as no alt text at all), then the library's.
 */
export function altModeOf(
  group: ImageAltGroup,
  values: Readonly<Record<string, unknown>>
): AltMode {
  if (values[group.decorative] === true) return "decorative";
  return isAuthoredText(values[group.alt]) ? "custom" : "library";
}

/** The page's own alt text as the field shows it, or `""` for none. */
export function storedAlt(
  group: ImageAltGroup,
  values: Readonly<Record<string, unknown>>
): string {
  const alt = values[group.alt];
  return isAuthoredText(alt) ? String(alt) : "";
}

/**
 * What committing the alt field's words writes. The field shows the words in
 * use: the page's own, else the library's. So:
 *
 * - words other than those in use are stored as the page's own;
 * - the words in use, committed unchanged, write nothing, so an image showing
 *   the library's words keeps following the library;
 * - an emptied field removes the page's own words, so the library's apply
 *   again; "Decorative, no alt text" is how an author says "none".
 */
export function altTextChanges(
  group: ImageAltGroup,
  typed: string,
  values: Readonly<Record<string, unknown>>,
  libraryAlt: string | undefined
): ImageChanges {
  const words = typed.trim();
  const own = values[group.alt];
  if (words === "") {
    return own === undefined ? {} : { [group.alt]: undefined };
  }
  const inUse = isAuthoredText(own) ? String(own).trim() : libraryAlt;
  return words === inUse ? {} : { [group.alt]: words };
}

/**
 * What ticking or clearing "Decorative, no alt text" writes: the mark alone,
 * so the alt text is kept for when it is cleared; the block ignores it while
 * the image is decorative. Only `true` marks an image decorative, as the
 * block reads it, so clearing a mark that is not set names nothing, and a
 * lock on it does not refuse the change.
 */
export function decorativeChanges(
  group: ImageAltGroup,
  on: boolean,
  values: Readonly<Record<string, unknown>>
): ImageChanges {
  if (on) return { [group.decorative]: true };
  return values[group.decorative] === true
    ? { [group.decorative]: undefined }
    : {};
}

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

import type { EditableProp } from "./inspector";

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

/** The modes, in the order the menu offers them. */
export const ALT_MODES: readonly AltMode[] = [
  "library",
  "custom",
  "decorative",
];

/** What the author calls each mode. */
export const ALT_MODE_LABELS: Readonly<Record<AltMode, string>> = {
  library: "From library",
  custom: "Custom",
  decorative: "Decorative",
};

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
 * What choosing `mode` writes. Each write is the least that puts the props in
 * that mode, so a prop already as the mode needs it is not named, and a lock
 * on it does not refuse the choice.
 *
 * - From library removes the page's alt and the decorative mark.
 * - Custom removes the mark and keeps the page's alt; where it stores none,
 *   it starts from the library's words (or none), which is what the image
 *   was already given, so the choice changes nothing a reader hears.
 * - Decorative sets the mark and keeps the alt, so switching back loses no
 *   words; the block ignores the alt while the image is decorative.
 */
export function altModeChanges(
  group: ImageAltGroup,
  mode: AltMode,
  values: Readonly<Record<string, unknown>>,
  libraryAlt: string | undefined
): ImageChanges {
  // Only `true` marks an image decorative, as the block reads it; a stored
  // `false` already means "not decorative", and naming it would refuse the
  // choice wherever the mark may not change.
  const marked = values[group.decorative] === true;
  const unmark = marked ? { [group.decorative]: undefined } : {};
  if (mode === "decorative") return { [group.decorative]: true };
  if (mode === "library") {
    return {
      ...unmark,
      ...(values[group.alt] === undefined ? {} : { [group.alt]: undefined }),
    };
  }
  return {
    ...unmark,
    ...(isAuthoredText(values[group.alt])
      ? {}
      : { [group.alt]: libraryAlt ?? "" }),
  };
}

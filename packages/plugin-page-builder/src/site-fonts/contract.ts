/**
 * What the editor and the server agree on about catalogue fonts: the two
 * routes, what each sends and answers, and how a catalogue file's address is
 * built.
 *
 * Kept free of server code, so the editor imports it too: a preview in the
 * editor and a download on the server name a file through the same function,
 * and cannot come to disagree about where it lives.
 *
 * @module site-fonts/contract
 */
import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import type { PaginationMeta } from "@nextlyhq/plugin-sdk";

/** Where the editor reads the Google Fonts catalogue, through the server. */
export const SITE_FONTS_CATALOGUE_ROUTE_PATH = "/site/fonts/catalogue";

/** Where the editor asks the server to add a catalogue font to the site. */
export const SITE_FONTS_ROUTE_PATH = "/site/fonts";

/** The catalogue's categories, in the order the editor offers them. */
export const FONT_CATEGORIES = [
  "sans-serif",
  "serif",
  "display",
  "handwriting",
  "monospace",
] as const;

export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** The two styles a catalogue family can come in. */
export type FontStyleName = "normal" | "italic";

/** One family in the catalogue, as the editor lists it. */
export interface CatalogueFamily {
  /** The catalogue's id, such as `inter`. What an add names. */
  readonly id: string;
  /** The family as written, such as `Inter`. */
  readonly family: string;
  readonly category: FontCategory;
  /** Each static weight offered, from 100 to 900. */
  readonly weights: readonly number[];
  readonly styles: readonly FontStyleName[];
  /** The scripts offered, such as `latin` and `cyrillic`. */
  readonly subsets: readonly string[];
  /** The script the catalogue chose as the family's own. */
  readonly defSubset: string;
  /** Whether one file per style covers every weight. */
  readonly variable: boolean;
  /** The licence as the catalogue names it, such as `OFL-1.1`. */
  readonly licence: string;
  /**
   * How many times the family was downloaded from npm in the last month, which
   * the editor orders "Popular" by. Absent when the catalogue's stats could
   * not be read, and the editor then orders by name.
   */
  readonly popularity?: number;
}

/** What the catalogue route answers. */
/**
 * The catalogue as its route answers it: the canonical list envelope, every
 * family on one page, with where previews load and when the catalogue was
 * read beside the paging in its meta.
 */
export interface FontCatalogueList {
  readonly items: readonly CatalogueFamily[];
  readonly meta: PaginationMeta & {
    readonly previewBase: string;
    readonly fetchedAt: string;
  };
}

export interface FontCatalogueRead {
  readonly families: readonly CatalogueFamily[];
  /**
   * Where previews load from in the editor: the catalogue's file host. Only
   * the editor's browser contacts it, and only while browsing.
   */
  readonly previewBase: string;
  /** When the server last read the catalogue, as an ISO time. */
  readonly fetchedAt: string;
}

/**
 * What the editor sends to add a catalogue font. It names a family and its
 * styles; the server builds every address from them.
 */
export interface AddSiteFontRequest {
  readonly id: string;
  /** The static weights to add, or `"variable"` for the one-file form. */
  readonly weights: readonly number[] | "variable";
  readonly styles: readonly FontStyleName[];
  readonly subsets: readonly string[];
}

/** What the add route answers: the faces it stored, and how many it skipped. */
export interface AddSiteFontAnswer {
  readonly added: readonly FontFaceDef[];
  readonly skipped: number;
}

/** One file of a catalogue family: a script, a weight or the axis, a style. */
export interface CatalogueFile {
  readonly id: string;
  /** The catalogue package's version, or `latest` for a preview. */
  readonly version: string;
  readonly subset: string;
  /** A static weight, or `"variable"` for the file covering every weight. */
  readonly weight: number | "variable";
  readonly style: FontStyleName;
}

/**
 * The address of one catalogue file under the file host.
 *
 * The one place it is spelled. The server downloads from it and the editor
 * previews from it; a second spelling would drift, and a preview of one file
 * beside a download of another is a preview that lies.
 */
export function catalogueFileUrl(base: string, file: CatalogueFile): string {
  const root = base.replace(/\/+$/, "");
  const variable = file.weight === "variable";
  const pkg = `${file.id}${variable ? ":vf" : ""}@${file.version}`;
  const cut = variable ? "wght" : String(file.weight);
  return `${root}/fontsource/fonts/${pkg}/${file.subset}-${cut}-${file.style}.woff2`;
}

/**
 * What a header & footer set's area pickers read: every PUBLISHED component
 * an author may put in the set's header or footer, the ones marked "Use as"
 * for that area first, then the others, with the published definitions each
 * picture, and the set's own canvas, are drawn from.
 *
 * Its own module, free of server imports, so the admin bundle takes the
 * shapes without the route's reads.
 *
 * @module set-area-choices-contract
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { LayoutArea } from "./collections/areas";

/** Where a set's area choices are read. */
export const SET_AREA_CHOICES_ROUTE_PATH = "/layouts/area-choices";

/** The query parameter naming the area: `header` or `footer`. */
export const SET_AREA_CHOICES_AREA_PARAM = "area";

/** The query parameter naming the language components are read in. */
export const SET_AREA_CHOICES_LOCALE_PARAM = "locale";

/**
 * The query parameter naming the component the set's area holds now, by id:
 * answered for, with its definitions, whatever the list's bound cut, since
 * the set's canvas draws it.
 */
export const SET_AREA_CHOICES_SELECTED_PARAM = "selected";

/**
 * The query parameter asking for every listed component's picture: the
 * definitions each reaches. Asked once a picker opens, so the read the canvas
 * draws from stays as small as the one component it draws.
 */
export const SET_AREA_CHOICES_PICTURES_PARAM = "pictures";

/** The most components one answer lists, sorted by title. */
export const MAX_SET_AREA_CHOICES = 100;

/** The path an area's choices are read from. */
export function setAreaChoicesPath(
  area: LayoutArea,
  options: {
    locale?: string | null;
    selected?: string | null;
    pictures?: boolean;
  } = {}
): string {
  const query = new URLSearchParams({ [SET_AREA_CHOICES_AREA_PARAM]: area });
  const locale = options.locale ?? "";
  if (locale !== "") query.set(SET_AREA_CHOICES_LOCALE_PARAM, locale);
  const selected = options.selected ?? "";
  if (selected !== "") query.set(SET_AREA_CHOICES_SELECTED_PARAM, selected);
  if (options.pictures === true) {
    query.set(SET_AREA_CHOICES_PICTURES_PARAM, "1");
  }
  return `${SET_AREA_CHOICES_ROUTE_PATH}?${query.toString()}`;
}

/** One component an author may put in the area. */
export interface SetAreaChoice {
  readonly id: string;
  /** Its title, or its id where it has none. */
  readonly title: string;
  /** Whether it is marked "Use as" for this area. */
  readonly marked: boolean;
}

/** The route's answer: the canonical list envelope. */
export interface SetAreaChoicesResponse {
  /** The marked components by title, then the others by title. */
  readonly items: readonly SetAreaChoice[];
  readonly meta: {
    readonly area: LayoutArea;
    /** Whether more components are published than the list holds. */
    readonly more: boolean;
    /**
     * The PUBLISHED definitions the drawn components reach, nested ones
     * included, by id: the selected one's always, every listed one's when
     * the pictures are asked for.
     */
    readonly definitions: Readonly<Record<string, BlockDocument>>;
  };
}

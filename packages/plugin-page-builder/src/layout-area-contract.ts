/**
 * What the header & footer area routes answer and are sent, shared by the
 * routes and the builder's "Use a component ▾" menu: the published
 * components marked for an area, and the write that puts one in a set's
 * area.
 *
 * Its own module, free of server imports, so an admin bundle takes the shapes
 * without the routes' reads and writes.
 *
 * @module layout-area-contract
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";

import type { LayoutArea } from "./collections/areas";

/** Where the components marked for an area are listed. */
export const AREA_COMPONENTS_ROUTE_PATH = "/layouts/area-components";

/** The query parameter naming the area: `header` or `footer`. */
export const AREA_COMPONENTS_AREA_PARAM = "area";

/** The query parameter naming the language the components are read in. */
export const AREA_COMPONENTS_LOCALE_PARAM = "locale";

/**
 * The query parameter asking for each listed component's picture: the
 * PUBLISHED definitions it reaches. Asked once the menu opens, so the read
 * that decides whether the menu is offered stays small.
 */
export const AREA_COMPONENTS_PICTURES_PARAM = "pictures";

/** The most components one answer lists, sorted by title. */
export const MAX_AREA_COMPONENTS = 50;

/** Where a set's area is given a component. */
export const LAYOUT_AREA_ROUTE_PATH = "/layouts/:id/areas/:area";

/** The path the components marked for `area` are read from. */
export function areaComponentsPath(
  area: LayoutArea,
  options: { locale?: string | null; pictures?: boolean } = {}
): string {
  const query = new URLSearchParams({ [AREA_COMPONENTS_AREA_PARAM]: area });
  const locale = options.locale ?? "";
  if (locale !== "") query.set(AREA_COMPONENTS_LOCALE_PARAM, locale);
  if (options.pictures === true) query.set(AREA_COMPONENTS_PICTURES_PARAM, "1");
  return `${AREA_COMPONENTS_ROUTE_PATH}?${query.toString()}`;
}

/** The path set `id`'s `area` is given a component at. */
export function layoutAreaPath(id: string, area: LayoutArea): string {
  return LAYOUT_AREA_ROUTE_PATH.replace(":id", encodeURIComponent(id)).replace(
    ":area",
    area
  );
}

/** One component an author may choose for an area. */
export interface AreaComponent {
  readonly id: string;
  /** Its title, or its id where it has none. */
  readonly title: string;
}

/** The components route's answer: the canonical list envelope. */
export interface AreaComponentsResponse {
  /** The published components marked for the area, sorted by title. */
  readonly items: readonly AreaComponent[];
  readonly meta: {
    readonly area: LayoutArea;
    /** Whether more are marked for the area than the list holds. */
    readonly more: boolean;
    /**
     * Whether the caller may put a component in a set's area: update AND
     * publish sets, since a set's areas are what every page using it shows.
     * The write itself still judges the set.
     */
    readonly mayChoose: boolean;
    /**
     * The PUBLISHED definitions the listed components reach, nested ones
     * included, by id: what each picture is drawn from. Sent only when the
     * pictures are asked for; empty otherwise.
     */
    readonly definitions: Readonly<Record<string, BlockDocument>>;
  };
}

/** What the area write is sent: the component to put there. */
export interface PutInAreaBody {
  readonly component: string;
}

/** The area write's answer: the set, the area and the component now in it. */
export interface WrittenArea {
  readonly set: { readonly id: string; readonly title: string };
  readonly area: LayoutArea;
  readonly component: { readonly id: string; readonly title: string };
}

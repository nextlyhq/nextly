/**
 * What the loop collections route answers, named where both ends can read it.
 *
 * A collection list stores the slug of the collection it reads, filter rows
 * and sort keys naming its fields, and, for related entries, a to-many
 * relation of the page's entry or of the outer item. The inspector offers
 * each as a menu, which needs the collections the author may read and, for
 * each, the fields visitors can see (a list may filter and sort only by
 * those) with what each holds, and its to-many relations. This module is
 * what the route and the admin client agree on.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives: the
 * route reaches the registry through the server, and a browser module
 * importing the route for one path constant would bring it along. Types are
 * the exception, since they are erased before a browser sees them.
 *
 * @module loop-collections-contract
 */
import type {
  FieldStoragePrimitive,
  ListFieldKind,
} from "@nextlyhq/blocks-engine";
import type { PaginationMeta } from "nextly";

/** Where the inspector lists a loop's collections, under this plugin's namespace. */
export const LOOP_COLLECTIONS_ROUTE_PATH = "/loop-collections";

/** The query the route takes: the language the fields are judged in. */
export const LOOP_COLLECTIONS_PARAMS = { locale: "locale" } as const;

/**
 * The route's path, asking in `locale`, the language being edited: a field's
 * public read rule may depend on the language, and a save judges the page's
 * lists in the language it writes, so the menu offers what that save takes.
 */
export function loopCollectionsPath(locale?: string): string {
  if (locale === undefined || locale === "") return LOOP_COLLECTIONS_ROUTE_PATH;
  const params = new URLSearchParams({
    [LOOP_COLLECTIONS_PARAMS.locale]: locale,
  });
  return `${LOOP_COLLECTIONS_ROUTE_PATH}?${params.toString()}`;
}

/** One choice of a choice field, as stored and as an author reads it. */
export interface LoopFieldOption {
  readonly value: string;
  readonly label: string;
}

/**
 * One field a list may filter by, and sort by unless it is a relation: a
 * field visitors can see, holding one value.
 */
export interface LoopListFieldItem {
  /** The name a filter row or a sort key stores. */
  readonly name: string;
  /** What the author calls it: its label, or its name in words. */
  readonly label: string;
  /** The kind of value it holds, the engine's `listFieldKind`. */
  readonly kind: ListFieldKind;
  /** A choice field's choices, in the field's order. */
  readonly options?: readonly LoopFieldOption[];
  /** The collection an entry field points at. */
  readonly relationTo?: string;
  /** A date picked as a day, which a filter compares as that day. */
  readonly dateOnly?: boolean;
}

/** A to-many relation a related list can show the entries of. */
export interface LoopRelationItem {
  /** The relation field a list's `relation.field` stores. */
  readonly field: string;
  /** What the author calls it. */
  readonly label: string;
  /** The collection its entries are in, which the list then names. */
  readonly collection: string;
}

/** One collection a loop can repeat over. */
export interface LoopCollectionItem {
  readonly slug: string;
  /** Its plural name where it has one, else its name, else its slug. */
  readonly label: string;
  /** Its name for one entry ("Post"), else its slug. */
  readonly singular: string;
  /**
   * The fields a list may filter and sort by, in the collection's order,
   * then its timestamps: only fields visitors can see, holding one value.
   */
  readonly fields: readonly LoopListFieldItem[];
  /** Its to-many relations visitors can see, to a listed collection. */
  readonly relations: readonly LoopRelationItem[];
  /**
   * Every field name the collection declares, so the inspector tells a
   * stored filter on a field visitors can't see from one on a field the
   * collection no longer has.
   */
  readonly declared: readonly string[];
  /**
   * Every field the public may read, as a save judges a list against them:
   * the offered fields are a narrower view of these.
   */
  readonly readable: readonly LoopReadableField[];
}

/**
 * One field the public may read, as far as a list's judgement needs it: every
 * key the engine's `listFieldKind` reads, so the editor gives a field the
 * kind a save gives it.
 */
export interface LoopReadableField {
  readonly name: string;
  /** What the admin calls it, for a menu offering a field no list filters by. */
  readonly label?: string;
  readonly type: string;
  readonly hasMany?: true;
  readonly relationTo?: string | readonly string[];
  /** A time of day, which no list filters or sorts by. */
  readonly timeOnly?: true;
  /** The primitive a plugin's field type is stored as, which gives its kind. */
  readonly storage?: FieldStoragePrimitive;
}

/**
 * What the route answers: the canonical list envelope, `{ items, meta }`,
 * every collection on one page.
 */
export interface LoopCollectionsResponse {
  readonly items: readonly LoopCollectionItem[];
  readonly meta: PaginationMeta;
}

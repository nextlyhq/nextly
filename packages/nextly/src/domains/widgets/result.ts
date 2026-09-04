/**
 * What a widget query ANSWERS with, whatever kind of source answered it.
 *
 * Its own module because two producers now share it: the collection path, which
 * compiles a query to the Direct API, and a system source's resolver, which
 * hands the question to a domain service. Left in `execute.ts`, the resolver
 * contract would import the executor and the executor would import the resolver
 * registry -- a cycle around a type neither of them owns.
 *
 * @module domains/widgets/result
 */

/**
 * One column of a list result, as the admin needs to head it.
 *
 * Carried on the RESULT rather than published as source metadata, and the
 * difference is an access-control one. A widget's declared source is proven
 * readable by the caller before a row is returned, and `select` names the
 * fields they asked for -- so answering with labels for exactly those fields
 * tells them nothing they did not already have. Publishing a source's field
 * list separately would be an enumeration surface: the endpoint is careful
 * that a source the caller may not read answers exactly as one that does not
 * exist, and a metadata channel beside it would undo that.
 */
export interface WidgetResultField {
  name: string;
  /** Absent when the source has no human label for this field. */
  label?: string;
}

export type WidgetResult =
  | {
      op: "count";
      total: number;
      /**
       * Whether `total` is a FLOOR rather than the whole answer.
       *
       * 🔴 Present because some counts cannot be computed in the database. Where
       * a source's rows are filtered by a rule the query cannot express — a
       * stored `owner-only` or `custom` read rule lives on the collection, not
       * on the sidecar table being counted — the only honest count walks
       * candidates and authorizes them, which is bounded work. Past that bound
       * the choice is to refuse, to publish a number that is quietly too small,
       * or to say plainly that there are at least this many.
       *
       * Saying so is the option that stays true: a reader learns the scale
       * without being told a wrong figure, and a card renders `1,000+` rather
       * than failing. Absent means the count is whole.
       */
      atLeast?: boolean;
    }
  | {
      op: "list";
      items: Record<string, unknown>[];
      /**
       * The selected fields, in the order they were asked for.
       *
       * Present only when the query declared `select`: without it the rows
       * carry whatever the collection holds, so there are no columns the
       * widget chose and nothing honest to head them with.
       */
      fields?: WidgetResultField[];
    };

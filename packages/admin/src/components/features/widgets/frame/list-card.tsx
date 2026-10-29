/**
 * A list card's body: its rows from one model, and one footer when it holds more than it draws.
 *
 * The model marks each field as the row's title, a meta field or a trailing field. At the small
 * and medium tiers the rows are stacked {@link EntityRow}s; at the large tier the same model is a
 * table whose header row names the title and each field, in the same order, with the same links
 * and actions, so the two forms never disagree about what a row is.
 *
 * The rows drawn are the ones the body holds (`drawn`, from `rowsDrawn`), never part of a row,
 * and nothing scrolls inside the card. A list that has a full list to open says "View all" in the
 * card's own footer (`CardFooterContent`), never under the rows, with "(N)" when it holds more than
 * the card draws. A list with nowhere to open has no footer: a footer holds a link, never a bare
 * count. There is no other way to say "see more".
 *
 * @module components/features/widgets/frame/list-card
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import type { ListDensity } from "nextly/config";
import { Fragment, type JSX, type ReactNode } from "react";

import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import {
  ENTITY_LEADING_CLASS,
  EntityRow,
  EntityRowActions,
  type EntityRowMenuItem,
} from "./entity-row";
import { CARD_FOOTER_LINK_CLASS, CardFooterContent } from "./footer-slot";
import {
  LIST_CLASS,
  ROWS_STACK_CLASS,
  TABLE_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TABLE_HEADING_CLASS,
  TABLE_ROW_CLASS,
  TABLE_ROW_HEIGHT_CLASS,
} from "./geometry";

/** A field a row shows beside its title: on the meta line, or in the trailing slot. */
export interface ListField<Row> {
  key: string;
  /** What the field is called, as the table form's column heading. */
  label: string;
  role: "meta" | "trailing";
  /** Where the table form sets the field's column: at its end for a time or a number. */
  align?: "start" | "end";
  /** The field's value in `row`, or `undefined` where the row has none. */
  present: (row: Row) => ReactNode | undefined;
}

/** What a list is made of: one title per row, its fields, and where each row leads. */
export interface ListModel<Row> {
  /** The title column's heading in the table form. */
  titleLabel: string;
  titleOf: (row: Row) => string;
  /** What assistive technology hears for a row, where its visible text reads badly aloud. */
  spokenOf?: (row: Row) => string | undefined;
  leadingOf?: (row: Row) => ReactNode;
  hrefOf?: (row: Row) => string | undefined;
  fields: readonly ListField<Row>[];
  /** The one visible action a widget may declare for its rows. */
  actionOf?: (row: Row) => { label: string; href: string } | undefined;
  menuOf?: (row: Row) => readonly EntityRowMenuItem[];
}

/** How many rows a list holds in all, when its source counts them. */
export interface ListTotal {
  count: number;
  /** The count is a floor: there are at least this many. */
  atLeast?: boolean;
}

export interface ListCardProps<Row> {
  model: ListModel<Row>;
  /** Every row the answer holds; the card draws the first `drawn`. */
  rows: readonly Row[];
  drawn: number;
  /** The list's whole count, when the source gave one. */
  total?: ListTotal;
  /** The full list the card was drawn from, carrying its filter and sort. */
  viewAllHref?: string;
  tier: SizeTier;
  density: ListDensity;
}

/** The largest number a footer writes in full; past it, "99+". */
const FOOTER_COUNT_CAP = 99;

export function ListCard<Row>({
  model,
  rows,
  drawn,
  total,
  viewAllHref,
  tier,
  density,
}: ListCardProps<Row>): JSX.Element {
  const shown = rows.slice(0, drawn);
  const footer = listFooter(rows.length, shown.length, total);
  return (
    <div data-testid="list-card" className={ROWS_STACK_CLASS}>
      {tier === "large" && model.fields.length > 0 ? (
        <ListTable model={model} rows={shown} density={density} />
      ) : (
        <ul data-testid="list-card-rows" className={LIST_CLASS}>
          {shown.map((row, index) => (
            // The position, because a widget's rows have no identity core can rely on, and
            // the list is replaced whole on every refetch with nothing in it holding state.
            <li key={index}>
              <EntityRow
                title={model.titleOf(row)}
                spoken={model.spokenOf?.(row)}
                leading={model.leadingOf?.(row)}
                meta={fieldsOf(model, row, "meta")}
                trailing={trailingOf(model, row)}
                href={model.hrefOf?.(row)}
                action={model.actionOf?.(row)}
                menu={model.menuOf?.(row)}
                density={density}
              />
            </li>
          ))}
        </ul>
      )}
      <ListFooter footer={footer} href={viewAllHref} />
    </div>
  );
}

/** A row's fields of one role, in the model's order. */
function fieldsOf<Row>(
  model: ListModel<Row>,
  row: Row,
  role: ListField<Row>["role"]
): ReactNode[] {
  return model.fields
    .filter(field => field.role === role)
    .map(field => field.present(row));
}

/** A row's trailing fields, side by side, each keyed by its field; nothing for none. */
function trailingOf<Row>(
  model: ListModel<Row>,
  row: Row
): ReactNode | undefined {
  const fields = model.fields
    .filter(field => field.role === "trailing")
    .map(field => ({ key: field.key, value: field.present(row) }))
    .filter(
      ({ value }) => value !== undefined && value !== null && value !== ""
    );
  if (fields.length === 0) return undefined;
  return fields.map(({ key, value }) => <Fragment key={key}>{value}</Fragment>);
}

/**
 * What a list's footer says: how many there are in all, whether that is a floor, and how many
 * of them the card drew.
 */
export interface FooterCount {
  count: number;
  atLeast: boolean;
  drawn: number;
}

/**
 * The footer a list needs, or `undefined` when it draws everything it holds.
 *
 * The count is the source's total where it gave one. Without one, the answer's extra row is the
 * only evidence: the card asked one more than it draws, so an answer holding it means at least
 * that many exist, and the count says so as a floor.
 */
export function listFooter(
  fetched: number,
  drawn: number,
  total: ListTotal | undefined
): FooterCount | undefined {
  if (total !== undefined) {
    return total.count > drawn
      ? { count: total.count, atLeast: total.atLeast === true, drawn }
      : undefined;
  }
  return fetched > drawn ? { count: fetched, atLeast: true, drawn } : undefined;
}

/** A count as a footer writes it: in full to 99, "99+" past it, and "N+" for a floor. */
export function countText(count: number, atLeast: boolean): string {
  if (count > FOOTER_COUNT_CAP) return `${FOOTER_COUNT_CAP}+`;
  return atLeast ? `${count}+` : String(count);
}

/** The same count as assistive technology reads it: "99 or more", "6 or more", or "42". */
export function countSpoken(count: number, atLeast: boolean): string {
  if (count > FOOTER_COUNT_CAP) return `${FOOTER_COUNT_CAP} or more`;
  return atLeast ? `${count} or more` : String(count);
}

/**
 * A list's one footer: "View all" to the full list it was drawn from, whenever there is one, so
 * the way there is always in the same place; "(N)" after it when the list holds more than the
 * card draws, N being how many it holds in all. Nothing where there is no list to open: a footer
 * holds a link, never a bare count. Used by every list card, and by a card of tiles. Drawn in the
 * card's footer, where every card's link is.
 */
export function ListFooter({
  footer,
  href,
}: {
  /** How many more the list holds than the card draws; `undefined` when it draws them all. */
  footer: FooterCount | undefined;
  href: string | undefined;
}): JSX.Element | null {
  if (href === undefined) return null;
  return (
    <CardFooterContent>
      <Link
        data-testid="list-card-footer"
        href={href}
        className={CARD_FOOTER_LINK_CLASS}
      >
        <span aria-hidden="true">
          View all
          {footer && ` (${countText(footer.count, footer.atLeast)})`}
        </span>
        <span className="sr-only">
          View all
          {footer && `, ${countSpoken(footer.count, footer.atLeast)}`}
        </span>
      </Link>
    </CardFooterContent>
  );
}

/** The large tier's form: the same rows as a table, its header row naming each field. */
function ListTable<Row>({
  model,
  rows,
  density,
}: {
  model: ListModel<Row>;
  rows: readonly Row[];
  density: ListDensity;
}) {
  const hasActions = rows.some(
    row =>
      model.actionOf?.(row) !== undefined ||
      (model.menuOf?.(row).length ?? 0) > 0
  );
  const rowClass = TABLE_ROW_HEIGHT_CLASS[density];
  return (
    <table data-testid="list-card-table" className={TABLE_CLASS}>
      <thead>
        <tr className={TABLE_HEAD_ROW_CLASS}>
          {/* The title takes the width the other columns leave; they size to what they hold. */}
          <th
            scope="col"
            className={cn(TABLE_HEADING_CLASS, "w-full text-muted-foreground")}
          >
            {model.titleLabel}
          </th>
          {model.fields.map(field => (
            <th
              key={field.key}
              scope="col"
              className={cn(
                TABLE_HEADING_CLASS,
                "w-px whitespace-nowrap text-muted-foreground",
                field.align === "end" && "text-right"
              )}
            >
              {field.label}
            </th>
          ))}
          {hasActions && (
            <th scope="col" className="w-24 pb-1">
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const href = model.hrefOf?.(row);
          const title = model.titleOf(row);
          const spoken = model.spokenOf?.(row);
          const leading = model.leadingOf?.(row);
          const titleBody = (
            <span className="flex min-w-0 items-center gap-2">
              {leading !== undefined && (
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center",
                    ENTITY_LEADING_CLASS[density]
                  )}
                >
                  {leading}
                </span>
              )}
              <span className="truncate">{title}</span>
            </span>
          );
          return (
            // The position, for the reason the stacked rows use it.
            <tr
              key={index}
              data-testid="list-card-table-row"
              className={cn(TABLE_ROW_CLASS, rowClass)}
            >
              {/* `max-w-0` lets the widest column shorten its title with "…" rather than push. */}
              <td className="w-full max-w-0 pr-4 align-middle">
                {href === undefined ? (
                  <PlainTitle title={titleBody} spoken={spoken} />
                ) : (
                  <Link
                    href={href}
                    aria-label={spoken}
                    className="font-medium text-foreground hover:underline"
                  >
                    {titleBody}
                  </Link>
                )}
              </td>
              {model.fields.map(field => (
                <td
                  key={field.key}
                  className={cn(
                    "w-px whitespace-nowrap pr-4 align-middle text-foreground last:pr-0",
                    field.align === "end" && "text-right"
                  )}
                >
                  {/* An em dash rather than an empty cell, so a missing value is visibly one. */}
                  {field.present(row) ?? "—"}
                </td>
              ))}
              {hasActions && (
                <td className="align-middle">
                  <RowActionsCell model={model} row={row} title={title} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * An unlinked row's title cell: what assistive technology hears is the spoken form where the row
 * has one, read in place of the visible title, as the stacked row reads it.
 */
function PlainTitle({
  title,
  spoken,
}: {
  title: ReactNode;
  spoken: string | undefined;
}) {
  if (spoken === undefined) return <>{title}</>;
  return (
    <>
      <span aria-hidden="true" className="contents">
        {title}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

/** The table form's last cell: the row's one action and its menu, as the stacked row has them. */
function RowActionsCell<Row>({
  model,
  row,
  title,
}: {
  model: ListModel<Row>;
  row: Row;
  title: string;
}) {
  // The stacked row's own action and menu, so the two forms draw them one way.
  return (
    <div className="flex justify-end">
      <EntityRowActions
        title={title}
        action={model.actionOf?.(row)}
        menu={model.menuOf?.(row)}
      />
    </div>
  );
}

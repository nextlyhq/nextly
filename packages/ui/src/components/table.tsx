import * as React from "react";

import { cn } from "../lib/utils";

type TableProps = React.HTMLAttributes<HTMLTableElement>;

/** @experimental */
const Table: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableProps> & React.RefAttributes<HTMLTableElement>
> = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = "Table";

type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>;

/** @experimental */
const TableHeader: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableHeaderProps> &
    React.RefAttributes<HTMLTableSectionElement>
> = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn("[&_tr]:border-b border-border", className)}
      {...props}
    />
  )
);
TableHeader.displayName = "TableHeader";

type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;

/** @experimental */
const TableBody: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableBodyProps> &
    React.RefAttributes<HTMLTableSectionElement>
> = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
);
TableBody.displayName = "TableBody";

type TableFooterProps = React.HTMLAttributes<HTMLTableSectionElement>;

/** @experimental */
const TableFooter: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableFooterProps> &
    React.RefAttributes<HTMLTableSectionElement>
> = React.forwardRef<HTMLTableSectionElement, TableFooterProps>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn(
        "border-t border-border font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
);
TableFooter.displayName = "TableFooter";

type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>;

/** @experimental */
const TableRow: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableRowProps> &
    React.RefAttributes<HTMLTableRowElement>
> = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border transition-colors data-[state=selected]:bg-primary/5",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement>;

/** @experimental */
const TableHead: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableHeadProps> &
    React.RefAttributes<HTMLTableCellElement>
> = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-11 px-4 text-left align-middle font-semibold text-xs text-foreground uppercase tracking-wider [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement>;

/** @experimental */
const TableCell: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableCellProps> &
    React.RefAttributes<HTMLTableCellElement>
> = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
);
TableCell.displayName = "TableCell";

type TableCaptionProps = React.HTMLAttributes<HTMLTableCaptionElement>;

/** @experimental */
const TableCaption: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<TableCaptionProps> &
    React.RefAttributes<HTMLTableCaptionElement>
> = React.forwardRef<HTMLTableCaptionElement, TableCaptionProps>(
  ({ className, ...props }, ref) => (
    <caption
      ref={ref}
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
);
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};

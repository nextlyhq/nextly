import * as React from "react";

import { cn } from "../lib/utils";

/** @experimental */
const Table: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.HTMLAttributes<HTMLTableElement>> &
    React.RefAttributes<HTMLTableElement>
> = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
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

/** @experimental */
const TableHeader: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.HTMLAttributes<HTMLTableSectionElement>> &
    React.RefAttributes<HTMLTableSectionElement>
> = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("[&_tr]:border-b border-border", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

/** @experimental */
const TableBody: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.HTMLAttributes<HTMLTableSectionElement>> &
    React.RefAttributes<HTMLTableSectionElement>
> = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

/** @experimental */
const TableFooter: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.HTMLAttributes<HTMLTableSectionElement>> &
    React.RefAttributes<HTMLTableSectionElement>
> = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

/** @experimental */
const TableRow: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.HTMLAttributes<HTMLTableRowElement>> &
    React.RefAttributes<HTMLTableRowElement>
> = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border transition-colors data-[state=selected]:bg-primary/5",
      className
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

/** @experimental */
const TableHead: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.ThHTMLAttributes<HTMLTableCellElement>> &
    React.RefAttributes<HTMLTableCellElement>
> = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 px-4 text-left align-middle font-semibold text-xs text-foreground uppercase tracking-wider [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

/** @experimental */
const TableCell: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.TdHTMLAttributes<HTMLTableCellElement>> &
    React.RefAttributes<HTMLTableCellElement>
> = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-4 py-3 align-middle [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

/** @experimental */
const TableCaption: React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.HTMLAttributes<HTMLTableCaptionElement>> &
    React.RefAttributes<HTMLTableCaptionElement>
> = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
));
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

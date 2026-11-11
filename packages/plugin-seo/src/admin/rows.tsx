/**
 * A row of the SEO panel's Advanced section, and the small button its rows
 * use.
 *
 * @module admin/rows
 */
import { Button } from "@nextlyhq/ui";
import type { ReactNode } from "react";

/** One row of the section: its label and sentence, a control, and below. */
export function Row({
  label,
  labelId,
  help,
  control,
  error,
  children,
}: {
  label: string;
  labelId?: string;
  help: string;
  control?: ReactNode;
  /** Why the row's value was refused at save, where it was. */
  error?: string | undefined;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 border-t border-border-subtle p-3.5">
      <div>
        <div id={labelId} className="text-[13px] font-semibold text-foreground">
          {label}
        </div>
        <p className="m-0 mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">
          {help}
        </p>
      </div>
      {control ?? <span />}
      {children === undefined ? null : (
        <div className="col-span-full grid gap-2">{children}</div>
      )}
      {error && (
        <p
          role="alert"
          className="col-span-full m-0 text-xs font-medium text-danger-text"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** The small outlined button rows use. */
export function RowButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-7 px-2.5 text-xs"
    >
      {children}
    </Button>
  );
}

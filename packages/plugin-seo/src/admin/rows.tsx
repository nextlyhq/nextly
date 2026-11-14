/**
 * A row of the SEO panel's Advanced section, and the small button its rows
 * use.
 *
 * @module admin/rows
 */
import { Button } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef, type ReactNode } from "react";

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

/**
 * Calls `reset` when the stored values (`stored`, as one key) change by
 * anything but the row's own writes, such as the document being read again
 * or switched to another language, so the row shows what the document holds.
 * Returns the function the row tells the key its own write leaves.
 */
export function useOutsideChange(
  stored: string,
  reset: () => void
): (written: string) => void {
  const expected = useRef(stored);
  const latestReset = useRef(reset);
  latestReset.current = reset;
  useEffect(() => {
    if (stored === expected.current) return;
    expected.current = stored;
    latestReset.current();
  }, [stored]);
  return written => {
    expected.current = written;
  };
}

/** Stored values as one key, an absent value read as none. */
export const keyOf = (...stored: unknown[]): string =>
  JSON.stringify(stored.map(value => value ?? null));

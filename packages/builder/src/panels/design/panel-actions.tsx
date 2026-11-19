/**
 * Pieces the Design panel's tabs share: the Keep / Remove pair a removal is
 * confirmed with, "Show N more" under a long list, the open row drawn past
 * a page, and a write that answers with a refusal or nothing.
 *
 * One copy each, so the Variables, Fonts and Shared styles tabs confirm,
 * page and report a refusal the same way.
 *
 * @module panel-actions
 */
import { Button } from "@nextlyhq/ui";
import * as React from "react";

/** The Keep and Remove buttons under a confirmation. */
export function KeepOrRemove({
  busy,
  onKeep,
  onRemove,
  removeLabel,
  removeHeld = false,
  removeDescribedBy,
}: {
  busy: boolean;
  onKeep: () => void;
  onRemove: () => void;
  /** The destructive button's words: "Remove Inter", "Remove 3". */
  removeLabel: string;
  /**
   * Remove waits while another write is pending, Keep does not: the author
   * can always back out. The caller says why beside it.
   */
  removeHeld?: boolean;
  /** The id of the words saying why Remove waits. */
  removeDescribedBy?: string;
}): React.JSX.Element {
  return (
    <div className="nx-vars-editor__actions">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="nx-vars-editor__button"
        disabled={busy}
        onClick={onKeep}
      >
        Keep
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="nx-vars-editor__button"
        disabled={busy || removeHeld}
        aria-describedby={removeHeld ? removeDescribedBy : undefined}
        onClick={onRemove}
      >
        {removeLabel}
      </Button>
    </div>
  );
}

/** "Show N more" under a list a page long, or nothing when all are shown. */
export function ShowMore({
  hidden,
  pageSize,
  onMore,
}: {
  /** How many rows are not shown yet. */
  hidden: number;
  pageSize: number;
  onMore: () => void;
}): React.JSX.Element | null {
  if (hidden <= 0) return null;
  return (
    <button type="button" className="nx-vars__link" onClick={onMore}>
      {`Show ${String(Math.min(hidden, pageSize))} more`}
    </button>
  );
}

/**
 * The rows a page shows, and the open row as well when it lies past them.
 *
 * A row whose editor is open can lie past the page: a variable added at the
 * end of a long group, or a shared style opened from another tab. Its row is
 * drawn on its own after the page rather than by raising the page, which
 * would mount every row before it.
 */
export function withOpenRow<T>(
  rows: readonly T[],
  limit: number,
  isOpen: (row: T) => boolean
): readonly T[] {
  const page = rows.slice(0, limit);
  const at = rows.findIndex(isOpen);
  const open = at >= limit ? rows[at] : undefined;
  return open === undefined ? page : [...page, open];
}

/**
 * A write that answers with its refusal, or nothing once it is stored: busy
 * while it runs, and the last refusal kept to be shown.
 */
export function useRefusableWrite(): {
  busy: boolean;
  refusal: string | null;
  run: (write: () => Promise<string | undefined>) => Promise<boolean>;
} {
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (write: () => Promise<string | undefined>): Promise<boolean> => {
      setBusy(true);
      setRefusal(null);
      try {
        const refused = await write();
        if (refused !== undefined) setRefusal(refused);
        return refused === undefined;
      } finally {
        setBusy(false);
      }
    },
    []
  );
  return { busy, refusal, run };
}

/** A refusal, said where the author is, or nothing. */
export function Refusal({
  refusal,
  id,
}: {
  refusal: string | null;
  id?: string;
}): React.JSX.Element | null {
  if (refusal === null) return null;
  return (
    <p className="nx-vars-editor__issue" id={id} role="alert">
      {refusal}
    </p>
  );
}

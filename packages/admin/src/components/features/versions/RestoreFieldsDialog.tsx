/**
 * "Restore…": the fields a version would put back into the editor.
 *
 * Every field the version holds differently is listed and chosen, and the
 * person may unchoose any. A field they may not read or change, or one no
 * longer in the content type, is shown unchosen and disabled with its reason,
 * so they can see what the version holds that will not come back. A field
 * with an unsaved edit says the restore replaces it. On a translated document
 * the dialog names the language the restore changes, and each shared field
 * says it changes every language.
 *
 * Nothing is stored here: confirming hands the chosen fields to the editor as
 * unsaved edits, and the person's own save or publish is the only write.
 *
 * @module components/features/versions/RestoreFieldsDialog
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Checkbox,
} from "@nextlyhq/ui";
import { useEffect, useState, type JSX } from "react";

import type { RestoreRow } from "./restore-plan";

export interface RestoreFieldsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionNo: number;
  rows: RestoreRow[];
  /** The language a translated document's restore changes, by name. */
  language?: string;
  onConfirm: (names: string[]) => void;
}

/** The fields chosen when the dialog opens: every one that may be restored. */
function initiallyChosen(rows: RestoreRow[]): Set<string> {
  return new Set(rows.filter(row => row.chosen).map(row => row.name));
}

export function RestoreFieldsDialog({
  open,
  onOpenChange,
  versionNo,
  rows,
  language,
  onConfirm,
}: RestoreFieldsDialogProps): JSX.Element {
  const [chosen, setChosen] = useState(() => initiallyChosen(rows));
  // Each opening starts from the version's own list, not the last choice.
  useEffect(() => {
    if (open) setChosen(initiallyChosen(rows));
  }, [open, rows]);

  const toggle = (name: string, on: boolean) =>
    setChosen(previous => {
      const next = new Set(previous);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  // In the list's order, so the editor applies them as they are shown.
  const names = rows.filter(row => chosen.has(row.name)).map(row => row.name);
  const count = names.length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore from version {versionNo}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                {language
                  ? `The chosen fields go back into the ${language} editor as unsaved edits.`
                  : "The chosen fields go back into the editor as unsaved edits."}{" "}
                Nothing is saved until you save or publish, and your other edits
                stay.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {rows.map(row => {
            const id = `restore-field-${row.name}`;
            return (
              <li
                key={row.name}
                className="flex items-start gap-3 rounded-md px-2 py-2"
              >
                <Checkbox
                  id={id}
                  checked={chosen.has(row.name)}
                  disabled={row.disabled !== undefined}
                  onCheckedChange={value => toggle(row.name, value === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={id}
                    className={
                      row.disabled
                        ? "text-sm text-muted-foreground"
                        : "text-sm font-medium text-foreground"
                    }
                  >
                    {row.label}
                  </label>
                  {row.reason ? (
                    <p className="text-xs text-muted-foreground">
                      {row.reason}
                    </p>
                  ) : null}
                  {row.shared && !row.disabled ? (
                    <p className="text-xs text-muted-foreground">
                      Changes every language
                    </p>
                  ) : null}
                  {row.replacesUnsaved && !row.disabled ? (
                    <p className="text-xs font-medium text-foreground">
                      Replaces your unsaved edit
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={count === 0}
            onClick={() => onConfirm(names)}
          >
            {count === 1 ? "Restore 1 field" : `Restore ${count} fields`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

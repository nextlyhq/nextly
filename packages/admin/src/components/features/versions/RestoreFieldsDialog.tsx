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
 * Each field is named as the editor lays it out, with the value it puts back,
 * so the person checks what they choose without leaving the dialog. Under the
 * list, three lines say what the restore changes and what it leaves alone.
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
import { Eye, Globe, History, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";

import type { RestoreRow } from "./restore-plan";
import { restoreValueText } from "./restore-value-text";

export interface RestoreFieldsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionNo: number;
  rows: RestoreRow[];
  /** The language a translated document's restore changes, by name. */
  language?: string;
  /**
   * The one field asked for by name ("Restore this field" on the comparison
   * page): it alone is chosen when the dialog opens, and the rest stay listed
   * so the person can add them.
   */
  only?: string;
  onConfirm: (names: string[]) => void;
}

/**
 * The fields chosen when the dialog opens: every one that may be restored, or
 * only the one asked for by name, where it may be.
 */
function initiallyChosen(rows: RestoreRow[], only?: string): Set<string> {
  const asked =
    only !== undefined && rows.some(row => row.name === only && row.chosen);
  return initiallyChosenOrKept(rows, name => !asked || name === only);
}

/** The field's name as the form places it: "Search result › Meta title". */
function placedLabel(row: RestoreRow): string {
  return [...(row.place ?? []), row.label].join(" › ");
}

/**
 * What the restore changes, from the fields chosen: the language, and how
 * many shared fields, which change every language.
 */
function scopeLine(language: string, sharedChosen: number): string {
  if (sharedChosen === 0) {
    return `Changes ${language} only. Other languages and shared fields stay as they are.`;
  }
  const fields = sharedChosen === 1 ? "field" : "fields";
  const verb = sharedChosen === 1 ? "changes" : "change";
  return `Changes ${language} and ${sharedChosen} shared ${fields}, which ${verb} every language.`;
}

/** The fields that may be restored and that `keep` keeps chosen. */
function initiallyChosenOrKept(
  rows: RestoreRow[],
  keep: (name: string) => boolean
): Set<string> {
  return new Set(
    rows.filter(row => row.chosen && keep(row.name)).map(row => row.name)
  );
}

export function RestoreFieldsDialog({
  open,
  onOpenChange,
  versionNo,
  rows,
  language,
  only,
  onConfirm,
}: RestoreFieldsDialogProps): JSX.Element {
  const [chosen, setChosen] = useState(() => initiallyChosen(rows, only));
  // The fields the list held when last read, so a refresh tells a field it adds from one the
  // person has already chosen or unchosen.
  const listed = useRef<ReadonlySet<string>>(
    new Set(rows.map(row => row.name))
  );
  const wasOpen = useRef(false);
  // What had focus when the dialog opened: the control that opened it. Read in a layout effect,
  // before the dialog moves focus into itself. The dialog is opened from state, so it has no
  // trigger of its own to hand focus back to.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      opener.current = document.activeElement;
    }
  }, [open]);
  useEffect(() => {
    if (open && !wasOpen.current) {
      // Each opening starts from the version's own list, not the last choice.
      setChosen(initiallyChosen(rows, only));
    } else if (open) {
      // The list read again while open: the person's choices stand, a field it adds comes in
      // chosen as any field does, and one it no longer offers goes.
      const seen = listed.current;
      setChosen(previous =>
        initiallyChosenOrKept(
          rows,
          name => !seen.has(name) || previous.has(name)
        )
      );
    }
    listed.current = new Set(rows.map(row => row.name));
    wasOpen.current = open;
  }, [open, rows, only]);

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
  const sharedChosen = rows.filter(
    row => row.shared && chosen.has(row.name)
  ).length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className="sm:max-w-xl"
        // Closed by Escape, Cancel or a restore, focus goes back to the control that opened the
        // dialog, where the person left off, as long as it is still on the page.
        onCloseAutoFocus={event => {
          const back = opener.current;
          opener.current = null;
          if (back?.isConnected) {
            event.preventDefault();
            back.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Restore from version {versionNo}?</AlertDialogTitle>
          <AlertDialogDescription>
            {language
              ? `Choose the fields to put back into the ${language} editor.`
              : "Choose the fields to put back into the editor."}{" "}
            They arrive as unsaved changes, so you can check them before saving.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          aria-label="Changed fields"
          className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border"
        >
          {rows.map(row => {
            const id = `restore-field-${row.name}`;
            const disabled = row.disabled !== undefined;
            // A field that cannot come back says why in place of its value.
            const detail = disabled
              ? row.reason
              : restoreValueText(row.value, Object.hasOwn(row, "value"));
            return (
              <li
                key={row.name}
                className={
                  disabled
                    ? "flex items-start gap-3 bg-muted/40 px-3 py-2.5"
                    : "flex items-start gap-3 px-3 py-2.5"
                }
              >
                <Checkbox
                  id={id}
                  checked={chosen.has(row.name)}
                  disabled={disabled}
                  onCheckedChange={value => toggle(row.name, value === true)}
                  aria-describedby={detail ? `${id}-detail` : undefined}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <label
                      htmlFor={id}
                      className={
                        disabled
                          ? "text-sm text-muted-foreground"
                          : "text-sm font-medium text-foreground"
                      }
                    >
                      {placedLabel(row)}
                    </label>
                    {row.shared ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3" aria-hidden="true" />
                        Shared · every language
                      </span>
                    ) : null}
                    {row.replacesUnsaved && !disabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-surface px-2 py-0.5 text-xs text-warning-text">
                        <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                        Replaces your unsaved edit
                      </span>
                    ) : null}
                  </div>
                  {detail ? (
                    <p
                      id={`${id}-detail`}
                      className="truncate text-xs text-muted-foreground"
                    >
                      {detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {language ? (
            <li className="flex items-start gap-2">
              <Globe className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {scopeLine(language, sharedChosen)}
            </li>
          ) : null}
          <li className="flex items-start gap-2">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Readers see nothing change until you publish.
          </li>
          <li className="flex items-start gap-2">
            <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Your other unsaved edits stay, and every version stays in History.
          </li>
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

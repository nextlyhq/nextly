/**
 * The redirects screen's two dialogs: adding or editing one redirect, and a
 * CSV file's dry run before it is imported. Drawn from the admin's own
 * `Dialog`, `FieldShell`, `Input`, `Select`, `Alert`, `Badge` and `Button`.
 *
 * @module admin/redirect-dialogs
 */
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldShell,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type BadgeProps,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef, type JSX } from "react";

import type {
  ImportResult,
  ImportRowView,
  RedirectType,
} from "../redirects/contract";

/** Each type as the form offers it, and as the list shows the status served. */
export const TYPE_TEXT: Readonly<
  Record<RedirectType, { choice: string; short: string }>
> = {
  permanent: { choice: "Permanent (301)", short: "301" },
  temporary: { choice: "Temporary (302)", short: "302" },
  gone: { choice: "Gone (410)", short: "410 Gone" },
};

/** The types, in the order the form offers them. */
const TYPES: readonly RedirectType[] = ["permanent", "temporary", "gone"];

/** What the form holds: a new redirect, or an edit of `editing`. */
export interface RedirectDraft {
  /** The redirect being edited; none for a new one. */
  editing?: string;
  from: string;
  to: string;
  type: RedirectType;
}

/** A line under the form: a hint, or why the server refused it. */
export interface DraftNote {
  kind: "help" | "refused";
  text: string;
  /** The redirect already at the From address, which a refusal offers to edit. */
  existing?: string;
}

/** The form that adds or edits one redirect, in a dialog. */
export function RedirectDialog(props: {
  draft: RedirectDraft | null;
  note: DraftNote | null;
  busy: boolean;
  onChange: (draft: RedirectDraft) => void;
  onSave: (draft: RedirectDraft) => void;
  onEditExisting: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const { draft, note } = props;
  const toRef = useRef<HTMLInputElement | null>(null);
  const editing = draft?.editing !== undefined;
  // Filled from an address not found, the To address is what is left to
  // type, so it takes the focus.
  const prefilled = draft !== null && !editing && draft.from !== "";
  useEffect(() => {
    if (prefilled) toRef.current?.focus();
  }, [prefilled]);

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={open => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent size="md">
        {draft === null ? null : (
          <form
            className="flex flex-col gap-4"
            onSubmit={event => {
              event.preventDefault();
              props.onSave(draft);
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit redirect" : "Add redirect"}
              </DialogTitle>
              <DialogDescription>
                Use * for the rest of an address: /old/* to /new/*. Permanent
                tells search engines the page moved for good; Gone, that it was
                removed and nothing replaces it.
              </DialogDescription>
            </DialogHeader>
            <FieldShell label="From" width="full">
              <Input
                value={draft.from}
                placeholder="/old-address or /old/*"
                autoComplete="off"
                spellCheck={false}
                // The From address is what a redirect is kept by: changing it
                // is a new redirect.
                disabled={editing}
                onChange={event =>
                  props.onChange({ ...draft, from: event.target.value })
                }
              />
            </FieldShell>
            <FieldShell label="Type" width="full">
              {field => (
                <Select
                  value={draft.type}
                  onValueChange={value =>
                    props.onChange({ ...draft, type: value as RedirectType })
                  }
                >
                  <SelectTrigger
                    id={field.id}
                    aria-describedby={field.describedBy}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map(type => (
                      <SelectItem key={type} value={type}>
                        {TYPE_TEXT[type].choice}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldShell>
            {/* A gone address sends no one anywhere, so it has no To. */}
            {draft.type === "gone" ? null : (
              <FieldShell label="To" width="full">
                <Input
                  ref={toRef}
                  value={draft.to}
                  placeholder="/new-address or /new/*"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={event =>
                    props.onChange({ ...draft, to: event.target.value })
                  }
                />
              </FieldShell>
            )}
            {note === null ? null : note.kind === "refused" ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {note.text}
                  {note.existing === undefined ? null : (
                    <>
                      {" "}
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() =>
                          props.onEditExisting(note.existing ?? "")
                        }
                      >
                        Edit that redirect
                      </Button>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                {note.text}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={props.busy}>
                {editing ? "Save redirect" : "Add redirect"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Each row's outcome, as its badge says it. */
const ROW_BADGE: Readonly<
  Record<
    ImportRowView["kind"],
    { text: string; variant: BadgeProps["variant"] }
  >
> = {
  new: { text: "New", variant: "success" },
  joined: { text: "Joined", variant: "warning" },
  replaced: { text: "Replaces", variant: "warning" },
  same: { text: "No change", variant: "default" },
  refused: { text: "Can't import", variant: "destructive" },
};

/** `n redirects`, `1 redirect`. */
const redirectCount = (count: number) =>
  `${count} redirect${count === 1 ? "" : "s"}`;

/** A file read for import: its name, and what each row would do. */
export interface ReadFile {
  name: string;
  /** The file's text, sent again to import it. */
  text: string;
  result: ImportResult;
}

/** A CSV file's dry run, and the button that imports it in one step. */
export function ImportDialog(props: {
  file: ReadFile | null;
  busy: boolean;
  onImport: (file: ReadFile) => void;
  onChooseAgain: () => void;
  onClose: () => void;
}): JSX.Element {
  const { file } = props;
  const rows = file?.result.rows ?? [];
  const refused = rows.filter(row => row.kind === "refused").length;
  const saved = rows.filter(
    row => row.kind !== "same" && row.kind !== "refused"
  ).length;
  return (
    <Dialog
      open={file !== null}
      onOpenChange={open => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import {file?.name}</DialogTitle>
          <DialogDescription>
            {rows.length} row{rows.length === 1 ? "" : "s"} read. Nothing has
            changed yet: a file is imported in full or not at all.
          </DialogDescription>
        </DialogHeader>
        {refused === 0 ? null : (
          <Alert variant="destructive">
            <AlertDescription>
              {`Fix the ${refused === 1 ? "row" : `${refused} rows`} that can't be imported and choose the file again. Nothing in it is imported until then.`}
            </AlertDescription>
          </Alert>
        )}
        <ul
          aria-label="What each row does"
          className="flex max-h-96 flex-col gap-3 overflow-y-auto text-sm"
        >
          {rows.map(row => (
            <li key={row.line} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={ROW_BADGE[row.kind].variant}>
                  {ROW_BADGE[row.kind].text}
                </Badge>
                <span className="font-mono">{row.from}</span>
                {row.to === "" ? null : (
                  <span className="font-mono text-muted-foreground">
                    → {row.to}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">{row.says}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {refused === 0 ? null : (
            <Button
              type="button"
              variant="outline"
              onClick={props.onChooseAgain}
            >
              Choose the fixed file
            </Button>
          )}
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              file === null || props.busy || refused > 0 || saved === 0
            }
            onClick={() => {
              if (file !== null) props.onImport(file);
            }}
          >
            Import {redirectCount(saved)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

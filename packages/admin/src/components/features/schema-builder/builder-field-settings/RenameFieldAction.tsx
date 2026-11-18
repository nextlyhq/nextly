/**
 * Rename… for a saved field: a dialog asking for the new name, judged as it is typed by the same
 * check the panel's Name box uses, so it accepts exactly the names the save accepts. The rename
 * reaches the Builder as one change to the field, which carries the conditions that read it.
 *
 * @module components/features/schema-builder/builder-field-settings/RenameFieldAction
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nextlyhq/ui";
import { useId, useState, type JSX } from "react";

import type { BuilderField } from "../types";

/** Why `name` cannot be the field's new name, or `null` when it can. */
function renameProblem(
  field: BuilderField,
  name: string,
  checkName: (name: string) => string | null
): string | null {
  if (name === field.name) return "That is its name now.";
  return checkName(name);
}

export function RenameFieldAction({
  field,
  initiallyOpen = false,
  checkName,
  onRename,
}: {
  field: BuilderField;
  /** Open with the dialog showing, as a row's Rename… asks. */
  initiallyOpen?: boolean;
  /** The panel's check of a name new at the field's place. */
  checkName: (name: string) => string | null;
  onRename: (name: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  const [name, setName] = useState(field.name);
  const inputId = useId();
  const problemId = useId();
  const problem = renameProblem(field, name, checkName);
  const called = field.label || field.name;
  const rename = () => {
    if (problem !== null) return;
    onRename(name);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground"
        onClick={() => {
          setName(field.name);
          setOpen(true);
        }}
      >
        Rename…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename {called}</DialogTitle>
            <DialogDescription>
              Its column and API key change to the new name when you save, and
              its values are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>New name</Label>
            <Input
              id={inputId}
              value={name}
              autoFocus
              aria-invalid={problem !== null}
              aria-describedby={problem !== null ? problemId : undefined}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  rename();
                }
              }}
            />
            {problem !== null && (
              <p
                id={problemId}
                role="alert"
                className="text-xs text-destructive"
              >
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={problem !== null} onClick={rename}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

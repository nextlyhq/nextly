"use client";

/**
 * Name a version, or clear its name.
 *
 * A dialog rather than an inline field: every rename in this admin is a dialog,
 * and a history row is a single click target whose job is opening a version —
 * putting an editable field inside it would compete with that.
 *
 * @module components/features/versions/VersionLabelDialog
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
import * as React from "react";

/**
 * Matches the server's bound. Enforced there too — this only spares the user a
 * round trip to find out.
 */
const MAX_LABEL_LENGTH = 100;

export interface VersionLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version being named, for the title and the confirm copy. */
  versionNo: number | null;
  /** Its current name, or null when it has none. */
  currentLabel: string | null;
  saving?: boolean;
  /** `null` clears the name. */
  onSubmit: (label: string | null) => void;
}

export function VersionLabelDialog({
  open,
  onOpenChange,
  versionNo,
  currentLabel,
  saving = false,
  onSubmit,
}: VersionLabelDialogProps) {
  // Seeded once, from the name the version had when this dialog was opened.
  //
  // Deliberately NOT resynced afterwards. The history list refetches — a rename
  // invalidates it — and reseeding on every change would wipe what the user was
  // part-way through typing, or worse, silently swap it for someone else's
  // edit and let them submit that instead.
  //
  // Reopening on a different version is handled by mounting a fresh dialog per
  // version rather than by an effect, so there is no stale draft to carry over.
  const [value, setValue] = React.useState(() => currentLabel ?? "");

  // The baseline is frozen alongside the draft. Comparing against the LIVE
  // prop would let a refetch reporting someone else's rename turn an untouched
  // field into a submittable change — enabling Save on a value this user never
  // typed, and overwriting the newer name with the one they opened.
  const [baseline] = React.useState(() => currentLabel);

  const trimmed = value.trim();
  const hadLabel = baseline !== null && baseline !== "";
  // Submitting an empty field clears the name. That is only a change when there
  // was one to clear, which is also what stops an empty form saving nothing.
  const isClearing = trimmed.length === 0;
  const unchanged = trimmed === (baseline ?? "");
  const tooLong = trimmed.length > MAX_LABEL_LENGTH;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || unchanged || tooLong) return;
    onSubmit(isClearing ? null : trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {hadLabel ? "Rename" : "Name"} version {versionNo}
            </DialogTitle>
            <DialogDescription>
              A name makes a version easier to find later than its number. Leave
              this empty to remove the name.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor="version-label">Name</Label>
            <Input
              id="version-label"
              value={value}
              autoFocus
              maxLength={MAX_LABEL_LENGTH}
              onChange={e => setValue(e.target.value)}
              placeholder="e.g. before the redesign"
              aria-describedby="version-label-hint"
            />
            <p
              id="version-label-hint"
              className="text-xs text-muted-foreground"
            >
              {isClearing && hadLabel
                ? "This will remove the current name."
                : `${trimmed.length} of ${MAX_LABEL_LENGTH} characters.`}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || unchanged || tooLong}>
              {saving ? "Saving..." : isClearing ? "Remove name" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

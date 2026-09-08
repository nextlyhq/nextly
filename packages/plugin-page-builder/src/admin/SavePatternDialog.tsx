"use client";

/**
 * Naming a selection on its way into the pattern library.
 *
 * The form is short on purpose. Saving a pattern happens mid-edit, from a
 * toolbar button, and every field between the author and the save is a reason
 * not to press it — so one field is required beyond the name, and it is
 * required because nothing downstream can guess it.
 *
 * ## What it does NOT ask for
 *
 * **The slug.** It is an identity rather than an address — nothing resolves a
 * pattern by it — so asking an author to type one is a second field restating
 * the name they just gave. The route derives it, which is also the only place
 * that could ever disambiguate one.
 *
 * **Where it may be used**, beyond the granularity. That is the planner's
 * answer, already given: the toolbar disabled the verb if this selection could
 * not be saved, so a dialog that reached this point is one the planner accepted.
 *
 * ## The draft survives a failed save
 *
 * The dialog stays open until the write settles and keeps what was typed if it
 * failed, which is the rule `breakpoint-dialog` records for the same reason:
 * closing on the click threw away a set the author had just built by hand, with
 * nothing left to recover it from. A slug collision is the expected failure
 * here — two patterns called "Hero" — and it is one the author fixes by
 * changing a field that is still on screen.
 *
 * @module admin/SavePatternDialog
 */
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from "@nextlyhq/ui";
import * as React from "react";

import {
  PATTERN_GRANULARITIES,
  type PatternGranularity,
  type SavePatternFields,
} from "../library-contract";

/**
 * What each granularity means, in the author's terms.
 *
 * A RECORD over the closed vocabulary rather than a list beside it: a
 * granularity added to the contract fails to compile here until somebody writes
 * the sentence an author will read. The select is then built from the
 * vocabulary's own order, so the two can never disagree about which exist.
 */
const GRANULARITY_COPY: Record<
  PatternGranularity,
  { label: string; hint: string }
> = {
  element: {
    label: "Element",
    hint: "One block, styled the way you want it.",
  },
  group: {
    label: "Group",
    hint: "A few blocks that belong together, like a heading and a button.",
  },
  section: {
    label: "Section",
    hint: "A band across the page, like a hero or a footer.",
  },
  page: {
    label: "Page",
    // The footgun this line exists to defuse. A page pattern is offered when an
    // author starts a page and NOT in the insert panel, so choosing it here
    // quietly puts the pattern somewhere they were not expecting to find it.
    hint: "A whole page. Offered when starting a new page, not when inserting into one.",
  },
};

/** Props for {@link SavePatternDialog}. */
export interface SavePatternDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * What is being saved, as the toolbar would name it.
   *
   * Shown so an author who selected several blocks can see how many are about
   * to travel — the canvas selection is behind a modal by the time they read
   * this.
   */
  subject: string;
  /**
   * Categories the library already uses, offered as suggestions.
   *
   * Suggestions rather than a closed list, because the useful groupings belong
   * to the site being built. Offering what exists is what stops one library
   * growing "Hero", "hero" and "Heroes" as three categories.
   *
   * Optional and allowed to arrive late: the field works before the library
   * read lands, and gains its suggestions when it does.
   */
  categories?: readonly string[];
  /**
   * Store the pattern, answering whether it was stored.
   *
   * `false` keeps the dialog open with the draft intact, which is the point: a
   * name collision is the expected refusal here, and it is fixed by changing a
   * field that has to still be on screen.
   *
   * The REASON arrives separately, on {@link SavePatternDialogProps.error},
   * because it is not available at this moment — the write records its failure
   * in state, which reaches a render rather than a promise.
   */
  onSave: (fields: SavePatternFields) => Promise<boolean>;
  /**
   * Why the last save failed, when one did.
   *
   * Rendered only after an attempt made from THIS dialog, so a failure left
   * over from an earlier save is not shown beside an untouched form.
   */
  error?: string;
}

/**
 * The dialog, mounted by whoever owns the editor.
 *
 * Controlled from outside so the verb that opens it lives with the other verbs
 * rather than inside the form. Its state resets when it opens rather than when
 * it closes: a close that happened because the save failed must keep what was
 * typed, and the two are indistinguishable from inside `onOpenChange`.
 */
export function SavePatternDialog({
  open,
  onOpenChange,
  subject,
  categories,
  onSave,
  error,
}: SavePatternDialogProps) {
  const [title, setTitle] = React.useState("");
  const [granularity, setGranularity] = React.useState<PatternGranularity | "">(
    ""
  );
  const [category, setCategory] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Whether a save has been attempted and refused SINCE this dialog opened.
  // The reason itself belongs to the writer and outlives any one form, so
  // rendering it unconditionally would put a previous save's failure beside a
  // form nobody has submitted.
  const [refused, setRefused] = React.useState(false);

  // Cleared when the dialog OPENS. Clearing on close would wipe the draft in
  // the one case it is worth keeping — a refused save, where the author has to
  // change something and try again.
  React.useEffect(() => {
    if (!open) return;
    setTitle("");
    setGranularity("");
    setCategory("");
    setDescription("");
    setRefused(false);
    setSaving(false);
  }, [open]);

  // Both required fields, checked here rather than left to the button's
  // `disabled` alone: a form submitted with Enter never presses the button.
  const complete = title.trim() !== "" && granularity !== "";

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    // NARROWED rather than asserted. `complete` is the same question, and a
    // boolean cannot carry the narrowing to the object below — so an assertion
    // there would be the one thing standing between an unanswered radio group
    // and an empty string reaching the collection.
    if (saving || granularity === "" || title.trim() === "") return;
    setSaving(true);
    setRefused(false);
    const saved = await onSave({
      title: title.trim(),
      granularity,
      ...(category.trim() === "" ? {} : { category: category.trim() }),
      ...(description.trim() === "" ? {} : { description: description.trim() }),
    });
    setSaving(false);
    if (saved) {
      onOpenChange(false);
      return;
    }
    setRefused(true);
  };

  const listId = React.useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={event => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Save as pattern</DialogTitle>
            <DialogDescription>
              {subject} will be copied into your library. The page is not
              changed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="nx-save-pattern-title">Name</Label>
              <Input
                id="nx-save-pattern-title"
                value={title}
                autoFocus
                required
                onChange={event => setTitle(event.target.value)}
                placeholder="Hero with call to action"
              />
            </div>

            <fieldset className="grid gap-2 border-0 p-0">
              {/* A fieldset with a legend rather than a label over a listbox.
                  Every option is a required decision with a sentence attached,
                  and a picker that has to be opened hides the sentences behind
                  a click — an author choosing "Page" without reading its line
                  files the pattern where they will not look for it. */}
              <legend className="p-0 text-sm font-medium">
                How much of a page is this?
              </legend>
              <RadioGroup
                value={granularity}
                onValueChange={value =>
                  setGranularity(value as PatternGranularity)
                }
              >
                {/* Built from the vocabulary rather than listed again, so the
                    options and the copy above cannot disagree about which
                    granularities exist. */}
                {PATTERN_GRANULARITIES.map(value => (
                  <div
                    key={value}
                    className="grid grid-cols-[auto_1fr] items-start gap-2"
                  >
                    <RadioGroupItem
                      value={value}
                      id={`nx-save-pattern-granularity-${value}`}
                      aria-describedby={`nx-save-pattern-granularity-${value}-hint`}
                      className="mt-1"
                    />
                    <div className="grid gap-0.5">
                      <Label htmlFor={`nx-save-pattern-granularity-${value}`}>
                        {GRANULARITY_COPY[value].label}
                      </Label>
                      <span
                        id={`nx-save-pattern-granularity-${value}-hint`}
                        className="text-xs text-muted-foreground"
                      >
                        {GRANULARITY_COPY[value].hint}
                      </span>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="nx-save-pattern-category">
                Category{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="nx-save-pattern-category"
                value={category}
                list={listId}
                onChange={event => setCategory(event.target.value)}
                placeholder="Heroes"
              />
              {/* A native suggestion list: it types like free text, which is
                  what the field is, while offering what the library already
                  uses. A closed picker would refuse the first category on a new
                  site, when there are none to pick. */}
              <datalist id={listId}>
                {(categories ?? []).map(name => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nx-save-pattern-description">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="nx-save-pattern-description"
                value={description}
                rows={2}
                onChange={event => setDescription(event.target.value)}
                placeholder="What this is for, and when to reach for it."
              />
            </div>

            {refused ? (
              // `role="alert"`, because it appears after a press the author has
              // already made and they may be looking at the button rather than
              // at the form.
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {error ?? "The pattern could not be saved. Try again."}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || saving}>
              {saving ? "Saving…" : "Save pattern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

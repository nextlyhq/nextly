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
import { useModalKeyboardHold } from "@nextlyhq/builder/shell";
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
  isInsertableGranularity,
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

/**
 * The granularities this form offers, which is not the whole vocabulary.
 *
 * A pattern is worth saving only if some surface can offer it back, and today
 * exactly one does: the insert panel, which asks `isInsertableGranularity`. A
 * page-granularity pattern is a way to START a page, the panel filters it out
 * by design, and the surface that would offer it does not exist yet — so
 * choosing it stores a row that disappears from the builder the moment it is
 * written.
 *
 * DERIVED from the same question the panel asks rather than a list with `page`
 * removed. When the start-from-a-pattern surface lands, what changes is which
 * granularities a surface can offer back — and that answer lives in the
 * contract, next to the map that classifies them, rather than here.
 */
const OFFERED_GRANULARITIES = PATTERN_GRANULARITIES.filter(value =>
  isInsertableGranularity(value)
);

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

  // The canvas's shortcuts are registered on the DOCUMENT, so a focus trap does
  // nothing about them: Delete, Mod+D and Alt+Arrow reach the page behind this
  // form, and Mod+K opens the palette over it. An author correcting a name can
  // destroy the block they are naming. Held for the form's whole lifetime
  // rather than while a field has focus, because the moment focus sits on a
  // radio or a button is exactly when a bare keystroke is a canvas verb.
  useModalKeyboardHold("save-pattern-dialog", open);

  /*
   * Enter submits, which the hold above would otherwise take away.
   *
   * The shortcut manager gives Enter to a field only where the field OWNS it —
   * a textarea or a contenteditable, which use it for a newline. In a
   * single-line input Enter is application behaviour, so a blocking layer
   * swallows it, and the form loses the keyboard path `submit` was written to
   * support: an author who fills this in and presses Enter never reaches the
   * button.
   *
   * Handled on the FORM rather than per input, and by asking whether the target
   * owns the key rather than naming the two fields — so a field added later
   * behaves the way its kind implies rather than the way this list remembered.
   *
   * React delivers this before the manager sees the event: its listener is on
   * the root container, which is inside `document`, so the bubble reaches it
   * first. What the manager does afterwards is too late to matter.
   */
  const submitOnEnter = (event: React.KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== "Enter" || event.defaultPrevented) return;
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    // A press on a button is that button's own, and submitting here would turn
    // Cancel into a save.
    if (target instanceof HTMLButtonElement) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
  };

  /*
   * Where focus goes when this closes.
   *
   * Radix restores focus to the TRIGGER, and this dialog has none — it is
   * opened from the toolbar, the context menu or the palette, which are three
   * different controls and two of them have unmounted by the time it closes. So
   * the fallback is the element that had focus when the form opened, captured
   * here and used only while it is still connected: otherwise focus lands on
   * the body and a keyboard author is returned to the top of the page.
   */
  const openedFrom = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const active = window.document.activeElement;
    openedFrom.current = active instanceof HTMLElement ? active : null;
  }, [open]);

  const listId = React.useId();

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // A dismissal DURING the write is ignored. Escape, the close button, a
        // click outside and Cancel all reach here, and none of them cancels the
        // request: the row would still be created while the author believed
        // they had stopped it, and reopening would let them submit a second.
        // Refusing to close is the honest answer, and the button already says
        // "Saving…".
        if (saving) return;
        onOpenChange(next);
      }}
    >
      {/* Capped and scrolled: four explained options and a refusal alert make
          this taller than a short viewport, and `DialogContent` is fixed with
          no maximum height of its own — so the footer, or the field that needs
          correcting, ends up off-screen with no way to reach it. The BODY
          scrolls rather than the whole dialog, which keeps Save and Cancel in
          view while the fields move. */}
      <DialogContent
        className="flex max-h-[85vh] flex-col"
        onCloseAutoFocus={event => {
          const origin = openedFrom.current;
          if (origin === null || !origin.isConnected) return;
          event.preventDefault();
          origin.focus();
        }}
      >
        <form
          onSubmit={event => void submit(event)}
          onKeyDown={submitOnEnter}
          className="flex min-h-0 flex-col"
        >
          <DialogHeader>
            <DialogTitle>Save as pattern</DialogTitle>
            <DialogDescription>
              {subject} will be copied into your library. The page is not
              changed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 gap-4 overflow-y-auto py-4">
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
              {/* The legend NAMES the group as well as heading the fieldset:
                  a Radix radio group is a `role="radiogroup"` div rather than a
                  native fieldset child, so it is not named by the legend on its
                  own and reaches a screen reader unlabelled. */}
              <legend
                id="nx-save-pattern-granularity-legend"
                className="p-0 text-sm font-medium"
              >
                How much of a page is this?
              </legend>
              <RadioGroup
                value={granularity}
                // NAMED, which `required` needs to mean anything. Radix mirrors
                // each item into a hidden native radio, and radios with no
                // `name` are not one group — so each is independently required
                // and choosing one satisfies none of the others. Measured: the
                // form reports invalid with a choice made, and a browser
                // refuses to submit it.
                name="granularity"
                required
                aria-required
                aria-labelledby="nx-save-pattern-granularity-legend"
                onValueChange={value =>
                  setGranularity(value as PatternGranularity)
                }
              >
                {/* Built from the vocabulary rather than listed again, so the
                    options and the copy above cannot disagree about which
                    granularities exist. */}
                {OFFERED_GRANULARITIES.map(value => (
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
              // Disabled rather than silently inert while the write runs, so
              // the control says what it will do rather than ignoring a press.
              disabled={saving}
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

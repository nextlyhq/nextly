"use client";

/**
 * Preview, in the editor's top bar: a split button.
 *
 * The press previews this version: the admin's own Preview for this
 * document, the one its header would offer, in the language being edited.
 * Its arrow opens a menu holding the same "Preview this version", and
 * "Preview as visitor", which shows the canvas as a visitor gets the page,
 * hiding the blocks whose conditions don't match. That view is the author's
 * own, for the session, and changes nothing stored. An eye and the words on
 * the press, as the header's own Preview: an icon alone is a guess at what
 * it opens. On a crowded bar, once the page title is at its shortest, the
 * words step aside, their tooltip and name staying.
 *
 * The preview renders the saved document only, so with unsaved changes the
 * press saves a draft first, and the menu says so: the author sees what the
 * canvas shows. The save is the bar's own Save, offered only where it keeps
 * the work unpublished, so a preview never publishes. Where no such Save is
 * offered (someone who may not save, or a page whose Save would publish it),
 * it says it shows the saved version.
 *
 * Where the admin offers no preview, the press goes and the arrow's menu
 * keeps "Preview as visitor" alone, which is the canvas's own. That item is
 * always listed, so it can be found: where it can't be used, it is disabled
 * and says why in place of what it does.
 *
 * Unavailable while the document is being saved, as the admin's own Preview
 * is: a preview minted mid-save could show the revision before the save.
 *
 * @module admin/editor/preview-button
 */
import {
  type DocumentActions,
  useDocumentActions,
  useDocumentPreview,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from "@nextlyhq/ui";
import { ChevronDown, Eye } from "lucide-react";
import { useId } from "react";

/** Said when the save before a preview did not store, with its reason under it. */
const FAILED = "Couldn't save, so the preview didn't open.";

type SaveOutcome = Awaited<
  ReturnType<NonNullable<DocumentActions["saveWithoutPublishing"]>>
>;

/**
 * Saves the draft and answers whether the preview may open; false closes the
 * tab it claimed. A refused or failed save says why, since the preview it
 * stopped would otherwise just vanish.
 */
async function savedFirst(save: () => Promise<SaveOutcome>): Promise<boolean> {
  let outcome: SaveOutcome;
  try {
    outcome = await save();
  } catch (error) {
    // The editor turns a failed store into an outcome; anything that still
    // throws is reported the same way rather than lost with the tab.
    toast.error(FAILED, {
      description: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  if (outcome.ok) return true;
  // An author who said no to a question was not refused, and a save that
  // already told the author needs no second message.
  if (outcome.reason !== "cancelled" && outcome.reported !== true) {
    toast.error(FAILED, { description: outcome.message });
  }
  return false;
}

/** "Preview as visitor", as the editor keeps it for the author. */
export interface VisitorPreview {
  /** Whether the canvas shows the page as a visitor gets it. */
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
  /** Why it can't be turned on here, or undefined where it can. */
  readonly unavailable: string | undefined;
}

/** What "Preview as visitor" does, under its name. */
const VISITOR_DOES = "Hides blocks whose conditions don’t match";

/** What the arrow is called, for what it holds. */
const OPTIONS = "Preview options";

/**
 * Moves focus to the button that opens Preview's menu: where the visitor
 * strip's Stop sends it, since the strip leaves the page with the button
 * that was pressed, and the menu is where the view is turned on again.
 */
export function focusPreviewMenu(): void {
  document.querySelector<HTMLElement>("[data-preview-menu]")?.focus();
}

/**
 * A menu row's name, and a line under it saying what it does or why not.
 * The line describes the row rather than joining its name, so a screen
 * reader says "Preview as visitor" and then what it does.
 */
function useRowWords(
  label: string,
  description: string | undefined
): {
  readonly words: React.JSX.Element;
  readonly named: Record<string, string>;
} {
  const id = useId();
  const words = (
    <span className="flex flex-col items-start gap-0.5">
      <span id={`${id}-name`}>{label}</span>
      {description === undefined ? null : (
        <span
          id={`${id}-said`}
          className="text-xs font-normal text-muted-foreground"
        >
          {description}
        </span>
      )}
    </span>
  );
  return {
    words,
    named: {
      "aria-labelledby": `${id}-name`,
      ...(description === undefined
        ? {}
        : { "aria-describedby": `${id}-said` }),
    },
  };
}

/** "Preview this version", or the saved one, as the press does it. */
function ThisVersionRow({
  action,
  savesFirst,
  disabled,
  onSelect,
}: {
  readonly action: string;
  readonly savesFirst: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const { words, named } = useRowWords(
    action,
    savesFirst ? "Saves a draft first" : undefined
  );
  return (
    <DropdownMenuItem inset disabled={disabled} onSelect={onSelect} {...named}>
      {words}
    </DropdownMenuItem>
  );
}

/**
 * "Preview as visitor": a checkbox row, disabled with its reason, which is
 * text in the row since a disabled row can't be hovered or focused for a
 * tooltip.
 */
function VisitorRow({
  visitor,
}: {
  readonly visitor: VisitorPreview;
}): React.JSX.Element {
  const why = visitor.unavailable;
  const { words, named } = useRowWords(
    "Preview as visitor",
    why ?? VISITOR_DOES
  );
  return (
    <DropdownMenuCheckboxItem
      checked={visitor.on && why === undefined}
      disabled={why !== undefined}
      onCheckedChange={visitor.onChange}
      {...named}
    >
      {words}
    </DropdownMenuCheckboxItem>
  );
}

export function PreviewButton({
  visitor,
}: {
  /** "Preview as visitor", the author's own view of the canvas. */
  readonly visitor: VisitorPreview;
}): React.JSX.Element {
  const preview = useDocumentPreview();
  const actions = useDocumentActions();

  const saveState = actions?.saveState.kind;
  const save = actions?.saveWithoutPublishing;
  // A failed save leaves the work unstored too, so it is saved first as well.
  // Whether any is left is the save's to answer: with nothing new it answers
  // stored at once, and a held Save closes the tab and says why.
  const unstored = saveState === "unsaved" || saveState === "failed";
  const action =
    save === undefined ? "Preview the saved version" : "Preview this version";
  // Handed to the preview rather than awaited here: it runs once the preview
  // has claimed its tab, so the save's round trip does not cost the click its
  // gesture and get the tab blocked.
  const step =
    save !== undefined && unstored ? () => savedFirst(save) : undefined;

  const open =
    preview === null
      ? undefined
      : () => {
          void (step === undefined ? preview.open() : preview.open(step));
        };
  const saving = saveState === "saving";

  const words = (
    <>
      <Eye className="size-4" aria-hidden="true" />
      {/* The word steps aside once the bar is crowded, after the page
          title has shortened as far as it goes (the builder's top bar
          measures it), and stays the button's name for a screen reader. */}
      <span data-topbar-word="">Preview</span>
    </>
  );

  return (
    <div className="flex items-center" data-preview-split="">
      {open === undefined ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          title={action}
          disabled={saving}
          className="rounded-r-none"
          onClick={open}
        >
          {words}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {open === undefined ? (
            // No press to sit beside: the menu's own button carries the
            // words, and its arrow says it opens a menu.
            <Button
              type="button"
              size="sm"
              variant="outline"
              title={OPTIONS}
              data-preview-menu=""
            >
              {words}
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-l-none border-l-0 px-1.5"
              aria-label={OPTIONS}
              title={OPTIONS}
              data-preview-menu=""
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {open === undefined ? null : (
            <ThisVersionRow
              action={action}
              savesFirst={step !== undefined}
              disabled={saving}
              onSelect={open}
            />
          )}
          <VisitorRow visitor={visitor} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

"use client";

/**
 * "+ New header & footer" in the Pages panel: a dialog asking for the new
 * set's name and what it starts from (a copy of the site default, the
 * starter header and footer, or empty), then opening the new set in the
 * builder, with a way back to where it was asked from.
 *
 * The set is made as a draft through the plugin's route, as the caller, so
 * the sets collection's own create rules decide; a refusal is said in the
 * dialog, which stays open with what was typed.
 *
 * @module admin/editor/new-set-dialog
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
} from "@nextlyhq/ui";
import { useId, useState, type FormEvent, type JSX } from "react";

import {
  LAYOUT_NEW_ROUTE_PATH,
  LAYOUT_TITLE_MAX,
  type NewLayoutBody,
  type NewLayoutStart,
  type WrittenLayout,
} from "../../layout-writes-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";

import { openDocument } from "./edit-component";
import { setBuilderAddress } from "./set-address";

/** What the dialog needs to know of the site's sets. */
export interface NewSetFacts {
  /** The sets collection, as the site resolved it. */
  readonly collection: string;
  /** The site default's title, or null where there is none to copy. */
  readonly defaultTitle: string | null;
  /** What the document open here is called, which the new set's Back says. */
  readonly here: string | undefined;
}

/** Each start, as the dialog words it. */
function startLabel(
  start: NewLayoutStart,
  defaultTitle: string | null
): string {
  if (start === "copy-default") return `A copy of ${defaultTitle ?? ""}`;
  if (start === "starter") return "The starter header and footer";
  return "Empty";
}

/** What each start makes, said under it. */
const START_NOTES: Readonly<Record<NewLayoutStart, string>> = {
  "copy-default": "The same header and footer, to change from there.",
  starter: "A new plain header and footer of its own, to edit.",
  empty: "No header or footer yet.",
};

/** What a refused write says: core's own words, or a plain fallback. */
function refusalOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The header & footer set could not be made. Try again.";
}

/** Make the set, answering it as written. */
async function makeSet(body: NewLayoutBody): Promise<WrittenLayout> {
  const answer = await writePluginRoute<{ item?: WrittenLayout }>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: LAYOUT_NEW_ROUTE_PATH,
    method: "POST",
    body,
  });
  if (answer?.item === undefined) {
    throw new Error("The set route answered without the set it made.");
  }
  return answer.item;
}

export function NewSetDialog({
  open,
  onOpenChange,
  facts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facts: NewSetFacts;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]" data-slot="new-set-dialog">
        <DialogTitle>New header & footer</DialogTitle>
        <DialogDescription>
          A set of a header and a footer that pages can use.
        </DialogDescription>
        {/* Mounted only while open, so each opening starts afresh. */}
        {open ? (
          <NewSetForm facts={facts} onCancel={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The dialog's form: the name, the start, and Create. */
function NewSetForm({
  facts,
  onCancel,
}: {
  facts: NewSetFacts;
  onCancel: () => void;
}): JSX.Element {
  const nameId = useId();
  const startId = useId();
  const starts: NewLayoutStart[] =
    facts.defaultTitle === null
      ? ["starter", "empty"]
      : ["copy-default", "starter", "empty"];
  const [title, setTitle] = useState("");
  const [start, setStart] = useState<NewLayoutStart>(starts[0] ?? "empty");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The set once made, with where it opens. Opening it may not happen: the
  // admin asks about unsaved work here first, and "Stay" keeps this page. So
  // it is kept, and the dialog opens it again rather than making another.
  const [made, setMade] = useState<{
    readonly title: string;
    readonly address: string;
  } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (made !== null) {
      openDocument(made.address);
      return;
    }
    const named = title.trim();
    if (named === "") {
      setProblem("Give the header & footer set a name.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const set = await makeSet({ title: named, start });
      const address = setBuilderAddress(
        facts.collection,
        set.id,
        window.location,
        facts.here
      );
      setMade({ title: named, address });
      setBusy(false);
      // Another document, loaded afresh: the admin asks first about unsaved
      // work here, as for any page opened from the builder.
      openDocument(address);
    } catch (error) {
      setProblem(refusalOf(error));
      setBusy(false);
    }
  };
  return (
    <form className="grid gap-4" onSubmit={event => void submit(event)}>
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={title}
          maxLength={LAYOUT_TITLE_MAX}
          onChange={event => setTitle(event.target.value)}
          aria-invalid={problem !== null ? true : undefined}
          autoFocus
        />
      </div>
      <fieldset className="grid gap-2">
        <legend id={startId} className="mb-1.5 text-sm font-medium">
          Start from
        </legend>
        <RadioGroup
          aria-labelledby={startId}
          value={start}
          onValueChange={value => setStart(value as NewLayoutStart)}
          className="grid gap-2"
        >
          {starts.map(each => (
            <StartChoice
              key={each}
              start={each}
              label={startLabel(each, facts.defaultTitle)}
            />
          ))}
        </RadioGroup>
      </fieldset>
      {problem === null ? null : (
        <p role="alert" className="m-0 text-sm text-destructive">
          {problem}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {made === null ? "Create" : `Open ${made.title}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** One start: its radio, its words and what it makes. */
function StartChoice({
  start,
  label,
}: {
  start: NewLayoutStart;
  label: string;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <RadioGroupItem id={id} value={start} className="mt-0.5" />
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {START_NOTES[start]}
        </span>
      </Label>
    </div>
  );
}

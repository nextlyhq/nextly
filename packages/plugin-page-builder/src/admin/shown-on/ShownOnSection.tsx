"use client";

/**
 * "Shown on (from the builder)", a section of a Single's side panel: each
 * page, header & footer set or component where the builder shows one of the
 * Single's values, with the block it sits in ("Home, Hero section"). Each
 * row opens that document in the builder with that block selected.
 *
 * Declared as a side panel section at the `single.edit` place, so core's
 * panel knows nothing of it and draws it among the sections plugins add,
 * after Last changed and before For developers. The panel draws its heading.
 *
 * It is honest about what it knows:
 * - only builder documents are listed, and it says so under the list;
 * - only places the person may open are listed; the others are a count,
 *   "and N you can't open";
 * - at most ten rows, then "and N more", which opens the full list;
 * - until the first check of every page has finished, it says it is still
 *   checking pages rather than that nothing shows the Single.
 *
 * The answer comes from the index the bindings sweep keeps, read in one
 * request (`shown-on-route.ts`).
 *
 * @module admin/shown-on/ShownOnSection
 */
import {
  navigateTo,
  type SidebarSectionProps,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import {
  SHOWN_ON_TITLE,
  type ShownOnAnswer,
  type ShownOnPlace,
} from "../../shown-on-contract";
import { navigateWithin } from "../plain-click";

import { placeAddress, useShownOn } from "./client";
import { SHOWN_ON_WORDS as WORDS } from "./words";

/** One place's row: a link into the builder, or plain words where none goes. */
function PlaceRow({ place }: { place: ShownOnPlace }): JSX.Element {
  const href = placeAddress(place);
  const words = WORDS.place(place.title, place.block);
  const dot = (
    <span
      aria-hidden="true"
      className="mt-[0.45rem] size-1.5 flex-none rounded-full bg-primary"
    />
  );
  return (
    <li className="flex items-start gap-2 text-sm leading-snug">
      {dot}
      {href === undefined ? (
        <span className="min-w-0 break-words text-foreground">
          {words}{" "}
          <span className="text-muted-foreground">
            ({WORDS.anotherLanguage})
          </span>
        </span>
      ) : (
        <a
          href={href}
          onClick={navigateWithin(href, navigateTo).onClick}
          className="min-w-0 break-words text-foreground underline-offset-2 hover:underline focus-visible:underline"
          data-testid="shown-on-place"
        >
          {words}
        </a>
      )}
    </li>
  );
}

/** The places, as a list. */
function PlaceList({
  places,
}: {
  places: readonly ShownOnPlace[];
}): JSX.Element {
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {places.map(place => (
        <PlaceRow key={place.key} place={place} />
      ))}
    </ul>
  );
}

/** Every place the person may open, read when the full list opens. */
function AllPlaces({
  slug,
  open,
  onOpenChange,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const read = useShownOn(slug, { all: true, enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{SHOWN_ON_TITLE}</DialogTitle>
          <DialogDescription>{WORDS.allDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto py-2">
          {read.data === undefined ? (
            read.error === null || read.error === undefined ? (
              <ListLoading />
            ) : (
              <LoadFailed onRetry={read.refetch} />
            )
          ) : (
            <div className="grid gap-3">
              <PlaceList places={read.data.places} />
              <Counts answer={{ ...read.data, more: 0 }} />
              <p className="m-0 text-xs text-muted-foreground">
                {WORDS.onlyBuilder}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The lines under the list: the places past ten, and those hidden. */
function Counts({
  answer,
  onMore,
}: {
  answer: Pick<ShownOnAnswer, "more" | "hidden">;
  onMore?: () => void;
}): JSX.Element | null {
  if (answer.more === 0 && answer.hidden === 0) return null;
  return (
    <div className="grid justify-items-start gap-1 pl-3.5 text-sm">
      {answer.more > 0 && onMore !== undefined ? (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm"
          onClick={onMore}
        >
          {WORDS.more(answer.more)}
        </Button>
      ) : null}
      {answer.hidden > 0 ? (
        <span className="text-muted-foreground">
          {WORDS.hidden(answer.hidden)}
        </span>
      ) : null}
    </div>
  );
}

/** While the answer is on its way: the height of a row, so nothing jumps. */
function ListLoading(): JSX.Element {
  return (
    <div aria-busy="true" className="grid gap-1.5">
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

/** A read that failed, and the way to ask again. */
function LoadFailed({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div role="alert" className="grid justify-items-start gap-1 text-sm">
      <span className="text-muted-foreground">{WORDS.loadFailed}</span>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-sm"
        onClick={onRetry}
      >
        {WORDS.retry}
      </Button>
    </div>
  );
}

/** The section's body, for one answer. */
function ShownOnBody({
  answer,
  onMore,
}: {
  answer: ShownOnAnswer;
  onMore: () => void;
}): JSX.Element {
  const empty = answer.places.length === 0;
  return (
    <div className="grid gap-2.5" data-testid="shown-on">
      {/* "Not shown" would be untrue where every place is one they can't
          open: the count below says it instead. */}
      {!empty ? (
        <PlaceList places={answer.places} />
      ) : answer.checking ? (
        <p className="m-0 text-sm text-muted-foreground">{WORDS.checking}</p>
      ) : answer.hidden === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{WORDS.none}</p>
      ) : null}
      <Counts answer={answer} onMore={onMore} />
      {!empty && answer.checking ? (
        <p className="m-0 text-sm text-muted-foreground">{WORDS.checking}</p>
      ) : null}
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">
        {WORDS.onlyBuilder}
      </p>
    </div>
  );
}

/** The side panel section, as the admin draws it on every Single. */
export function ShownOnSection({
  context,
}: SidebarSectionProps): JSX.Element | null {
  const slug = "single" in context ? context.single : null;
  if (slug === null) return null;
  return <ShownOnForSingle slug={slug} />;
}

/** The section for one Single. */
function ShownOnForSingle({ slug }: { slug: string }): JSX.Element {
  const read = useShownOn(slug);
  const [allOpen, setAllOpen] = useState(false);
  if (read.data === undefined) {
    return read.error === null || read.error === undefined ? (
      <ListLoading />
    ) : (
      <LoadFailed onRetry={read.refetch} />
    );
  }
  return (
    <>
      <ShownOnBody answer={read.data} onMore={() => setAllOpen(true)} />
      <AllPlaces slug={slug} open={allOpen} onOpenChange={setAllOpen} />
    </>
  );
}

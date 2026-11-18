"use client";

/**
 * The New page dialog's Address: the site's address and the page's part,
 * shown as text with a button to change it, and what the dialog knows about
 * it: made from the title, moved on because it is in use, or held by
 * another page.
 *
 * While the author hasn't changed it, the page's part follows the title by
 * the route's own rule (`pageSlugOfTitle`), so it reads right at once, and
 * the read then says whether it moves on. Once they change it, it stops
 * following the title and is theirs, refused at create when taken.
 *
 * @module admin/new-page/new-page-address
 */
import { Button, Input, Label } from "@nextlyhq/ui";
import { Pencil } from "lucide-react";
import { useId, useRef, type JSX, type RefObject } from "react";

import type { NewPageAddress } from "../../pages-write-contract";

import { movedOnWords, NEW_PAGE_WORDS } from "./new-page-words";

/** The site's address as the dialog shows it: no scheme, no last slash. */
function siteWords(site: string | null): string {
  if (site === null) return "";
  return site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export interface NewPageAddressFieldProps {
  /** What the read answered, or undefined before the first answer. */
  readonly address: NewPageAddress | undefined;
  /** Whether the read's answer is for what is typed now. */
  readonly current: boolean;
  /** The page's part the dialog shows while it follows the title. */
  readonly fromTitle: string;
  /** What the author typed, once they changed it; undefined while it follows. */
  readonly typed: string | undefined;
  readonly onType: (typed: string) => void;
  /** The create's refusal of the address, or none. */
  readonly refused: string | undefined;
}

/** What the field shows, worked out from what it is given. */
interface AddressView {
  readonly editing: boolean;
  /** The page's part shown in the address text. */
  readonly shown: string;
  /** The site's address and the path before the page's part. */
  readonly lead: string;
  readonly tail: string;
  /** Why the address can't be used, or none. */
  readonly problem: string | undefined;
  /** Said where the address made from the title moves on, or none. */
  readonly movedOn: string | undefined;
}

/** Until the first answer: a page served at `/<address>`, on no known site. */
const NO_ANSWER = { site: null, before: "/", after: "" };

function addressView(props: NewPageAddressFieldProps): AddressView {
  const { address, current, fromTitle, typed, refused } = props;
  const editing = typed !== undefined;
  // The read's own address where it answers what is typed now; until then
  // the part made from the title, so typing never waits on the network.
  const answered = current ? address : undefined;
  const around = address ?? NO_ANSWER;
  const takenBy = editing ? answered?.takenBy : undefined;
  const wanted = editing ? undefined : answered?.wanted;
  const path = (part: string) => `${around.before}${part}${around.after}`;
  return {
    editing,
    shown: editing || answered === undefined ? fromTitle : answered.slug,
    lead: `${siteWords(around.site)}${around.before}`,
    tail: around.after,
    problem:
      refused ??
      (takenBy === undefined
        ? undefined
        : `That address is used by ${takenBy}`),
    movedOn:
      wanted === undefined || answered === undefined
        ? undefined
        : movedOnWords(path(wanted), path(answered.slug)),
  };
}

export function NewPageAddressField(
  props: NewPageAddressFieldProps
): JSX.Element {
  const id = useId();
  const noteId = `${id}-note`;
  const problemId = `${id}-problem`;
  const input = useRef<HTMLInputElement>(null);
  const view = addressView(props);
  const describedBy = [
    view.editing ? undefined : noteId,
    view.problem === undefined ? undefined : problemId,
  ]
    .filter(part => part !== undefined)
    .join(" ");
  const startEditing = () => {
    props.onType(view.shown);
    // Into the field once it is drawn, with the address selected.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };

  return (
    <div className="grid gap-1.5" data-slot="new-page-address">
      <Label htmlFor={view.editing ? id : `${id}-change`}>
        {NEW_PAGE_WORDS.address}
      </Label>
      {view.editing ? (
        <AddressInput
          id={id}
          input={input}
          lead={view.lead}
          value={props.typed ?? ""}
          onType={props.onType}
          describedBy={describedBy}
          invalid={view.problem !== undefined}
        />
      ) : (
        <AddressText
          changeId={`${id}-change`}
          view={view}
          describedBy={describedBy}
          onChange={startEditing}
        />
      )}
      {view.editing ? null : (
        <p id={noteId} className="text-xs text-muted-foreground">
          {NEW_PAGE_WORDS.addressNote}
        </p>
      )}
      {/* Said before creating, so the address a page gets is never a surprise. */}
      <p
        aria-live="polite"
        className="text-xs text-foreground empty:hidden"
        data-slot="new-page-address-moved"
      >
        {view.movedOn}
      </p>
      {view.problem === undefined ? null : (
        <p id={problemId} role="alert" className="text-xs text-destructive">
          {view.problem}
        </p>
      )}
    </div>
  );
}

/** The address as text, the page's part stressed, with the button that changes it. */
function AddressText({
  changeId,
  view,
  describedBy,
  onChange,
}: {
  changeId: string;
  view: AddressView;
  describedBy: string;
  onChange: () => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center">
      <span
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1 font-mono text-xs text-muted-foreground"
        data-slot="new-page-address-text"
      >
        <span className="min-w-0 truncate">
          {view.lead}
          <span className="text-foreground">{view.shown}</span>
          {view.tail}
        </span>
        <Button
          id={changeId}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={NEW_PAGE_WORDS.changeAddress}
          aria-describedby={describedBy}
          className="size-6 shrink-0 rounded-full bg-muted text-muted-foreground hover:text-foreground"
          onClick={onChange}
        >
          <Pencil aria-hidden="true" className="size-3" />
        </Button>
      </span>
    </div>
  );
}

/** The address being changed: the site's address, then the field. */
function AddressInput({
  id,
  input,
  lead,
  value,
  onType,
  describedBy,
  invalid,
}: {
  id: string;
  input: RefObject<HTMLInputElement | null>;
  lead: string;
  value: string;
  onType: (typed: string) => void;
  describedBy: string;
  invalid: boolean;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {lead === "" ? null : (
        <span
          aria-hidden="true"
          className="max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground"
        >
          {lead}
        </span>
      )}
      <Input
        ref={input}
        id={id}
        value={value}
        onChange={event => onType(event.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        className="h-8 min-w-0 flex-1 font-mono text-xs"
      />
    </div>
  );
}

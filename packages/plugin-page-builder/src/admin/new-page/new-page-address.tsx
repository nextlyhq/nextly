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
import { useId, useRef, type JSX } from "react";

import type { NewPageAddress } from "../../pages-write-contract";

import { movedOnWords, NEW_PAGE_WORDS } from "./new-page-words";

/** The site's address as the dialog shows it: no scheme, no last slash. */
export function siteWords(site: string | null): string {
  if (site === null) return "";
  return site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** The whole address as one line: site, the path before, the page's part, after. */
export function addressWords(
  around: Pick<NewPageAddress, "site" | "before" | "after">,
  slug: string
): { lead: string; own: string; tail: string } {
  return {
    lead: `${siteWords(around.site)}${around.before}`,
    own: slug,
    tail: around.after,
  };
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

export function NewPageAddressField({
  address,
  current,
  fromTitle,
  typed,
  onType,
  refused,
}: NewPageAddressFieldProps): JSX.Element {
  const id = useId();
  const noteId = `${id}-note`;
  const problemId = `${id}-problem`;
  const input = useRef<HTMLInputElement>(null);
  const editing = typed !== undefined;
  // The read's own address where it answers what is typed now; until then
  // the part made from the title, so typing never waits on the network.
  const shown =
    current && address !== undefined && !editing ? address.slug : fromTitle;
  const around = address ?? { site: null, before: "/", after: "" };
  const words = addressWords(around, shown);
  const takenBy = current && editing ? address?.takenBy : undefined;
  const problem =
    refused ??
    (takenBy === undefined ? undefined : `That address is used by ${takenBy}`);
  const movedOn =
    !editing && current && address?.wanted !== undefined
      ? movedOnWords(
          `${around.before}${address.wanted}${around.after}`,
          `${around.before}${address.slug}${around.after}`
        )
      : undefined;
  const describedBy = [
    editing ? "" : noteId,
    problem === undefined ? "" : problemId,
  ]
    .filter(part => part !== "")
    .join(" ");

  return (
    <div className="grid gap-1.5" data-slot="new-page-address">
      <Label htmlFor={editing ? id : `${id}-change`}>
        {NEW_PAGE_WORDS.address}
      </Label>
      {editing ? (
        <div className="flex min-w-0 items-center gap-1.5">
          {words.lead === "" ? null : (
            <span
              aria-hidden="true"
              className="max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground"
            >
              {words.lead}
            </span>
          )}
          <Input
            ref={input}
            id={id}
            value={typed}
            onChange={event => onType(event.target.value)}
            aria-describedby={describedBy}
            aria-invalid={problem === undefined ? undefined : true}
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center">
          <span
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1 font-mono text-xs text-muted-foreground"
            data-slot="new-page-address-text"
          >
            <span className="min-w-0 truncate">
              {words.lead}
              <span className="text-foreground">{words.own}</span>
              {words.tail}
            </span>
            <Button
              id={`${id}-change`}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={NEW_PAGE_WORDS.changeAddress}
              aria-describedby={describedBy}
              className="size-6 shrink-0 rounded-full bg-muted text-muted-foreground hover:text-foreground"
              onClick={() => {
                onType(shown);
                // Into the field once it is drawn, with the address selected.
                requestAnimationFrame(() => {
                  input.current?.focus();
                  input.current?.select();
                });
              }}
            >
              <Pencil aria-hidden="true" className="size-3" />
            </Button>
          </span>
        </div>
      )}
      {editing ? null : (
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
        {movedOn}
      </p>
      {problem === undefined ? null : (
        <p id={problemId} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

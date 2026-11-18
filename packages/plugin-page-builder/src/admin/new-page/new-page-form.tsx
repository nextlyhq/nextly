"use client";

/**
 * The New page dialog's body: Type (where the builder offers more than one
 * kind of page), Title, Address, Header & footer, Start from, a line saying
 * how the page is saved, then Cancel and "Create and open builder".
 *
 * Nothing is created until the primary button is pressed (or Enter in Title
 * or Address presses it): leaving a field does nothing, and Escape or Cancel
 * closes without creating. A refusal keeps the dialog open with everything
 * typed: a taken address under Address, a field the page also needs named
 * with the server's words, anything else above the buttons.
 *
 * @module admin/new-page/new-page-form
 */
import {
  apiErrorMessage,
  navigateTo,
  validationIssues,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useEffect, useId, useState, type JSX } from "react";
import { useForm } from "react-hook-form";

import {
  pageSlugOfTitle,
  pageSlugOfTyped,
  type CreatedPageItem,
  type CreatePageRequest,
  type NewPageFacts,
} from "../../pages-write-contract";
import { NewPageLayoutPicker } from "../page-layout";
import { createPage } from "../pages-client";

import { NewPageAddressField } from "./new-page-address";
import { useNewPageFacts } from "./new-page-facts";
import { NewPageStarters } from "./new-page-starters";
import { fieldWords, NEW_PAGE_WORDS } from "./new-page-words";

/** What the author answered when the page on screen holds unsaved work. */
export type UnsavedAnswer = "saved" | "discard" | "keep";

/**
 * The page on screen's unsaved work, asked about before anything is made:
 * `ask` resolves once a chosen Save has succeeded ("saved"), with
 * "discard", or with "keep" for Keep editing or a Save that failed.
 */
export interface UnsavedWorkAsk {
  readonly ask: () => Promise<UnsavedAnswer>;
  /** Lets the move to the new page go without the leave guard asking again. */
  readonly leaveWithoutWarning: () => void;
}

export interface NewPageFormProps {
  /** The collection the page is made in, at first. */
  readonly collection: string;
  /** Whether to offer "Type" where more than one collection opens in the builder. */
  readonly offerType?: boolean;
  /** The page on screen's unsaved work, where there is any to ask about. */
  readonly unsaved?: UnsavedWorkAsk;
  readonly onCancel: () => void;
  /** Called with the page once made; the caller opens it. */
  readonly onCreated: (page: CreatedPageItem) => void;
  /** Told the collection's facts as they arrive, for the dialog's title. */
  readonly onFacts?: (facts: NewPageFacts) => void;
}

/** The fields the dialog draws itself, whose refusals it shows in place. */
const OWN_FIELDS = new Set([
  "title",
  "slug",
  "layout",
  "noHeaderFooter",
  "starter",
  "collection",
]);

/** A refused create, sorted by where the dialog shows each part. */
interface Refusal {
  readonly title?: string;
  readonly address?: string;
  /** Fields the dialog doesn't ask for, each with the server's words. */
  readonly fields: readonly { path: string; message: string }[];
  /** Anything else: the server's reason, above the buttons. */
  readonly general?: string;
}

/** Sort a create's refusal into the places the dialog shows it. */
export function refusalOf(error: unknown): Refusal {
  const issues = validationIssues(error).map(issue => ({
    path: issue.path ?? "",
    message: issue.message ?? "",
  }));
  if (issues.length === 0) {
    return {
      fields: [],
      general: apiErrorMessage(error, "Couldn't create the page."),
    };
  }
  const at = (path: string) =>
    issues.find(issue => issue.path === path)?.message;
  const fields = issues
    .filter(issue => !OWN_FIELDS.has(issue.path.split(".")[0] ?? ""))
    .map(issue => ({ path: issue.path, message: issue.message }));
  const own = issues.filter(issue =>
    OWN_FIELDS.has(issue.path.split(".")[0] ?? "")
  );
  const shownInPlace = new Set(["title", "slug"]);
  const elsewhere = own.filter(issue => !shownInPlace.has(issue.path));
  const title = at("title");
  const address = at("slug");
  return {
    ...(title === undefined ? {} : { title }),
    ...(address === undefined ? {} : { address }),
    fields,
    ...(elsewhere.length === 0
      ? {}
      : { general: elsewhere.map(issue => issue.message).join(" ") }),
  };
}

/** The header & footer choice, as the dialog's own small form holds it. */
interface LayoutValues {
  layout: string | null;
  noHeaderFooter: boolean;
}

export function NewPageForm({
  collection: startIn,
  offerType = false,
  unsaved,
  onCancel,
  onCreated,
  onFacts,
}: NewPageFormProps): JSX.Element {
  const id = useId();
  const [collection, setCollection] = useState(startIn);
  const [title, setTitle] = useState("");
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [starter, setStarter] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const layout = useForm<LayoutValues>({
    defaultValues: { layout: null, noHeaderFooter: false },
  });
  const typedSlug = typed === undefined ? undefined : pageSlugOfTyped(typed);
  const read = useNewPageFacts({
    collection,
    title,
    ...(typedSlug === undefined || typedSlug === "" ? {} : { slug: typedSlug }),
  });
  const facts = read.facts;
  useEffect(() => {
    if (facts !== undefined) onFacts?.(facts);
  }, [facts, onFacts]);

  const titled = title.trim() !== "";
  const mayUpdate = facts?.mayUpdate ?? true;
  const primaryWords = busy
    ? NEW_PAGE_WORDS.creating
    : mayUpdate
      ? NEW_PAGE_WORDS.createAndOpen
      : NEW_PAGE_WORDS.create;
  const reasonId = `${id}-reason`;

  const request = (): CreatePageRequest => {
    const values = layout.getValues();
    return {
      collection,
      title: title.trim(),
      ...(typedSlug === undefined || typedSlug === ""
        ? {}
        : { slug: typedSlug }),
      ...(facts?.headerFooter === true
        ? { layout: values.layout, noHeaderFooter: values.noHeaderFooter }
        : {}),
      ...(starter === undefined ? {} : { starter }),
    };
  };

  const submit = async (): Promise<void> => {
    if (!titled || busy) return;
    setRefusal(undefined);
    setBusy(true);
    try {
      // Asked before the create, so Keep editing makes nothing.
      const answer = unsaved === undefined ? "saved" : await unsaved.ask();
      if (answer === "keep") return;
      let page: CreatedPageItem;
      try {
        page = await createPage(request());
      } catch (error) {
        setRefusal(refusalOf(error));
        return;
      }
      if (answer === "discard") unsaved?.leaveWithoutWarning();
      onCreated(page);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid min-w-0 gap-4"
      data-slot="new-page-form"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      {offerType && facts !== undefined && facts.collections.length > 1 ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-type`}>{NEW_PAGE_WORDS.type}</Label>
          <Select
            value={collection}
            onValueChange={next => {
              setCollection(next);
              setRefusal(undefined);
            }}
          >
            <SelectTrigger id={`${id}-type`} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {facts.collections.map(option => (
                <SelectItem key={option.slug} value={option.slug}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>{NEW_PAGE_WORDS.title}</Label>
        <Input
          id={`${id}-title`}
          value={title}
          autoFocus
          autoComplete="off"
          aria-invalid={refusal?.title === undefined ? undefined : true}
          aria-describedby={
            refusal?.title === undefined ? undefined : `${id}-title-problem`
          }
          onChange={event => setTitle(event.target.value)}
          className="h-9"
        />
        {refusal?.title === undefined ? null : (
          <p
            id={`${id}-title-problem`}
            role="alert"
            className="text-xs text-destructive"
          >
            {refusal.title}
          </p>
        )}
      </div>
      {facts !== undefined && facts.address === null ? null : (
        <NewPageAddressField
          address={facts?.address ?? undefined}
          current={read.current}
          fromTitle={titled ? pageSlugOfTitle(title) : ""}
          typed={typed}
          onType={next => {
            setTyped(next);
            if (refusal?.address !== undefined) {
              setRefusal({ ...refusal, address: undefined });
            }
          }}
          refused={refusal?.address}
        />
      )}
      {facts?.headerFooter === true ? (
        <NewPageLayoutPicker control={layout.control} />
      ) : null}
      <NewPageStarters
        starters={facts?.starters ?? []}
        chosen={starter}
        onChoose={setStarter}
      />
      <AlsoNeeded collection={collection} fields={refusal?.fields ?? []} />
      {refusal?.general === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {refusal.general}
        </p>
      )}
      <div className="-mx-6 -mb-6 mt-1 flex flex-wrap items-center gap-2 border-t border-border px-6 py-3 max-sm:mt-auto">
        <p className="mr-auto text-xs text-muted-foreground">
          {facts === undefined
            ? NEW_PAGE_WORDS.loading
            : facts.drafts
              ? NEW_PAGE_WORDS.savedAsDraft
              : NEW_PAGE_WORDS.visibleAtOnce}
        </p>
        <Button type="button" variant="outline" onClick={onCancel}>
          {NEW_PAGE_WORDS.cancel}
        </Button>
        <Button
          type="submit"
          disabled={!titled || busy}
          aria-describedby={titled ? undefined : reasonId}
        >
          {primaryWords}
        </Button>
        {titled ? null : (
          <p
            id={reasonId}
            className="basis-full text-right text-xs text-muted-foreground"
          >
            {NEW_PAGE_WORDS.titleNeeded}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * The fields a create was refused for that the dialog doesn't draw, each
 * named with the server's words, and the way to fill them on the form.
 */
function AlsoNeeded({
  collection,
  fields,
}: {
  collection: string;
  fields: readonly { path: string; message: string }[];
}): JSX.Element | null {
  if (fields.length === 0) return null;
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
      data-slot="new-page-also-needed"
    >
      <p className="text-sm font-medium">{NEW_PAGE_WORDS.alsoNeeded}</p>
      <ul className="grid gap-1.5">
        {fields.map(field => (
          <li key={field.path} className="grid gap-0.5">
            <span className="text-sm">{fieldWords(field.path)}</span>
            <span className="text-xs text-destructive">{field.message}</span>
          </li>
        ))}
      </ul>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            navigateTo(
              `/admin/collections/${encodeURIComponent(collection)}/create`
            )
          }
        >
          {NEW_PAGE_WORDS.openForm}
        </Button>
      </div>
    </div>
  );
}

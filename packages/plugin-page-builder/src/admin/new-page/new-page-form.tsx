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
import { useEffect, useId, useRef, useState, type JSX } from "react";
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
function refusalOf(error: unknown): Refusal {
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

/**
 * Below 600 px wide the dialog is a full-height sheet, whichever frame holds
 * it: the admin's, from a list, or the builder's own. Carried by the form,
 * since the list's frame is the admin's to draw; matched only where this
 * form is inside, so no other dialog changes.
 */
const SHEET_BELOW_600 = `@media (max-width: 599.98px) {
  [data-slot="dialog-content"]:has([data-slot="new-page-form"]) {
    inset: 0;
    translate: none;
    width: 100%;
    max-width: none;
    height: 100dvh;
    border-width: 0;
    border-radius: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  [data-slot="new-page-form"] {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
  }
  [data-slot="new-page-footer"] {
    margin-top: auto;
  }
  [data-slot="new-page-footer"] > p {
    flex-basis: 100%;
  }
  [data-slot="new-page-footer"] > button {
    flex: 1 1 0;
  }
}`;

/** The header & footer choice, as the dialog's own small form holds it. */
interface LayoutValues {
  layout: string | null;
  noHeaderFooter: boolean;
}

/** What a create is made from, as the form holds it. */
interface CreateInputs {
  readonly collection: string;
  readonly title: string;
  readonly typedSlug: string | undefined;
  readonly starter: string | undefined;
  readonly facts: NewPageFacts | undefined;
  readonly layout: () => LayoutValues;
}

/** The create body for what is in the form. */
function requestOf(inputs: CreateInputs): CreatePageRequest {
  const values = inputs.layout();
  return {
    collection: inputs.collection,
    title: inputs.title.trim(),
    ...(inputs.typedSlug === undefined || inputs.typedSlug === ""
      ? {}
      : { slug: inputs.typedSlug }),
    ...(inputs.facts?.headerFooter === true
      ? { layout: values.layout, noHeaderFooter: values.noHeaderFooter }
      : {}),
    ...(inputs.starter === undefined ? {} : { starter: inputs.starter }),
  };
}

/**
 * The create: asked about unsaved work first where there is any, so Keep
 * editing makes nothing; then made; and on Discard, only once made, the
 * move to it let go without the leave guard asking again.
 *
 * A dismissed dialog opens nothing: once Cancel is pressed or the form is
 * gone (Escape, a click outside, the dialog opened again), a create still
 * on its way neither opens its page nor lets a move go unasked.
 */
function useCreate(
  unsaved: UnsavedWorkAsk | undefined,
  onCreated: (page: CreatedPageItem) => void
): {
  busy: boolean;
  refusal: Refusal | undefined;
  setRefusal: (refusal: Refusal | undefined) => void;
  create: (request: () => CreatePageRequest) => Promise<void>;
  dismiss: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  // Moved on by each create and by each dismissal: a create whose number
  // has moved on was dismissed.
  const attempt = useRef(0);
  const dismiss = () => {
    attempt.current += 1;
  };
  useEffect(() => dismiss, []);
  const create = async (request: () => CreatePageRequest): Promise<void> => {
    if (busy) return;
    attempt.current += 1;
    const mine = attempt.current;
    const dismissed = () => attempt.current !== mine;
    setRefusal(undefined);
    setBusy(true);
    try {
      const answer = unsaved === undefined ? "saved" : await unsaved.ask();
      if (answer === "keep" || dismissed()) return;
      let page: CreatedPageItem;
      try {
        page = await createPage(request());
      } catch (error) {
        if (!dismissed()) setRefusal(refusalOf(error));
        return;
      }
      if (dismissed()) return;
      if (answer === "discard") unsaved?.leaveWithoutWarning();
      onCreated(page);
    } finally {
      setBusy(false);
    }
  };
  return { busy, refusal, setRefusal, create, dismiss };
}

/** What the author has put in the dialog, and what the read says about it. */
function useInputs(
  startIn: string,
  onFacts: ((facts: NewPageFacts) => void) | undefined
) {
  const [collection, setCollection] = useState(startIn);
  const [title, setTitle] = useState("");
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [starter, setStarter] = useState<string | undefined>(undefined);
  const layout = useForm<LayoutValues>({
    defaultValues: { layout: null, noHeaderFooter: false },
  });
  const typedSlug = typed === undefined ? undefined : pageSlugOfTyped(typed);
  const asked =
    typedSlug === undefined || typedSlug === "" ? {} : { slug: typedSlug };
  const read = useNewPageFacts({ collection, title, ...asked });
  const facts = read.facts;
  useEffect(() => {
    if (facts !== undefined) onFacts?.(facts);
  }, [facts, onFacts]);
  const request = (): CreatePageRequest =>
    requestOf({
      collection,
      title,
      typedSlug,
      starter,
      facts,
      layout: () => layout.getValues(),
    });
  return {
    collection,
    setCollection,
    title,
    setTitle,
    typed,
    setTyped,
    starter,
    setStarter,
    layout,
    read,
    facts,
    request,
  };
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
  const inputs = useInputs(startIn, onFacts);
  const { facts } = inputs;
  const { busy, refusal, setRefusal, create, dismiss } = useCreate(
    unsaved,
    onCreated
  );
  const titled = inputs.title.trim() !== "";

  return (
    <form
      className="grid min-w-0 gap-4"
      data-slot="new-page-form"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        if (titled) void create(inputs.request);
      }}
    >
      {offerType ? (
        <TypeRow
          id={`${id}-type`}
          facts={facts}
          collection={inputs.collection}
          onChoose={next => {
            inputs.setCollection(next);
            setRefusal(undefined);
          }}
        />
      ) : null}
      <TitleRow
        id={`${id}-title`}
        title={inputs.title}
        onTitle={inputs.setTitle}
        problem={refusal?.title}
      />
      <AddressRow
        facts={facts}
        current={inputs.read.current}
        title={inputs.title}
        typed={inputs.typed}
        onType={next => {
          inputs.setTyped(next);
          if (refusal?.address !== undefined) {
            setRefusal({ ...refusal, address: undefined });
          }
        }}
        refused={refusal?.address}
      />
      {facts?.headerFooter === true ? (
        <NewPageLayoutPicker control={inputs.layout.control} />
      ) : null}
      <NewPageStarters
        starters={facts?.starters ?? []}
        chosen={inputs.starter}
        onChoose={inputs.setStarter}
      />
      <Refused collection={inputs.collection} refusal={refusal} />
      <style>{SHEET_BELOW_600}</style>
      <Footer
        reasonId={`${id}-reason`}
        facts={facts}
        titled={titled}
        busy={busy}
        onCancel={() => {
          dismiss();
          onCancel();
        }}
      />
    </form>
  );
}

/** The Address, where the collection's pages have one. */
function AddressRow({
  facts,
  current,
  title,
  typed,
  onType,
  refused,
}: {
  facts: NewPageFacts | undefined;
  current: boolean;
  title: string;
  typed: string | undefined;
  onType: (typed: string) => void;
  refused: string | undefined;
}): JSX.Element | null {
  if (facts !== undefined && facts.address === null) return null;
  return (
    <NewPageAddressField
      address={facts?.address ?? undefined}
      current={current}
      fromTitle={title.trim() === "" ? "" : pageSlugOfTitle(title)}
      typed={typed}
      onType={onType}
      refused={refused}
    />
  );
}

/** A refusal shown above the buttons: fields the page also needs, or the server's reason. */
function Refused({
  collection,
  refusal,
}: {
  collection: string;
  refusal: Refusal | undefined;
}): JSX.Element {
  return (
    <>
      <AlsoNeeded collection={collection} fields={refusal?.fields ?? []} />
      {refusal?.general === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {refusal.general}
        </p>
      )}
    </>
  );
}

/** "Type", first, where more than one kind of page opens in the builder. */
function TypeRow({
  id,
  facts,
  collection,
  onChoose,
}: {
  id: string;
  facts: NewPageFacts | undefined;
  collection: string;
  onChoose: (collection: string) => void;
}): JSX.Element | null {
  if (facts === undefined || facts.collections.length < 2) return null;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{NEW_PAGE_WORDS.type}</Label>
      <Select value={collection} onValueChange={onChoose}>
        <SelectTrigger id={id} className="h-9">
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
  );
}

/** "Title", focused when the dialog opens, with a refusal of it under it. */
function TitleRow({
  id,
  title,
  onTitle,
  problem,
}: {
  id: string;
  title: string;
  onTitle: (title: string) => void;
  problem: string | undefined;
}): JSX.Element {
  const problemId = `${id}-problem`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{NEW_PAGE_WORDS.title}</Label>
      <Input
        id={id}
        value={title}
        autoFocus
        autoComplete="off"
        aria-invalid={problem === undefined ? undefined : true}
        aria-describedby={problem === undefined ? undefined : problemId}
        onChange={event => onTitle(event.target.value)}
        className="h-9"
      />
      {problem === undefined ? null : (
        <p id={problemId} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/** How the page is saved, Cancel, and the button that makes it. */
function Footer({
  reasonId,
  facts,
  titled,
  busy,
  onCancel,
}: {
  reasonId: string;
  facts: NewPageFacts | undefined;
  titled: boolean;
  busy: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div
      className="-mx-6 -mb-6 mt-1 flex flex-wrap items-center gap-2 border-t border-border px-6 py-3"
      data-slot="new-page-footer"
    >
      <p className="mr-auto text-xs text-muted-foreground">
        {savedWords(facts)}
      </p>
      <Button type="button" variant="outline" onClick={onCancel}>
        {NEW_PAGE_WORDS.cancel}
      </Button>
      <Button
        type="submit"
        disabled={!titled || busy}
        aria-describedby={titled ? undefined : reasonId}
      >
        {primaryWords(busy, facts?.mayUpdate ?? true)}
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
  );
}

/** The line saying how the page is saved, once the collection is known. */
function savedWords(facts: NewPageFacts | undefined): string {
  if (facts === undefined) return NEW_PAGE_WORDS.loading;
  return facts.drafts
    ? NEW_PAGE_WORDS.savedAsDraft
    : NEW_PAGE_WORDS.visibleAtOnce;
}

/** The primary button's words: "Create" for an author who may not change the page. */
function primaryWords(busy: boolean, mayUpdate: boolean): string {
  if (busy) return NEW_PAGE_WORDS.creating;
  return mayUpdate ? NEW_PAGE_WORDS.createAndOpen : NEW_PAGE_WORDS.create;
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

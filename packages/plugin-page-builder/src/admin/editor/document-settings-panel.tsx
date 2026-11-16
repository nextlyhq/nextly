"use client";

/**
 * The right panel with nothing selected: the open document's own settings,
 * so clicking off every block never leaves a dead panel, and the panel keeps
 * its width, so the canvas never rescales on a click.
 *
 * Every row edits the entry's own form, as typing in Settings would: the
 * page's title in the top bar and the Save button follow at once, and the
 * change is saved with the page's draft. Nothing here is a second copy of a
 * field: the header & footer row is the one picker Settings and the entry
 * page draw, and "All page settings…" opens Settings itself.
 *
 * @module admin/editor/document-settings-panel
 */
import type { DocumentKind } from "@nextlyhq/blocks-engine";
import {
  useDocumentField,
  usePluginRoute,
  type DocumentField,
} from "@nextlyhq/plugin-sdk/admin";
import { Button, Input, Label } from "@nextlyhq/ui";
import { Check, Copy } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Control, FieldValues } from "react-hook-form";

import { PAGE_BUILDER_PLUGIN_NAME } from "../../library-contract";
import {
  pageAddressPath,
  type PageAddressResponse,
} from "../../pages-search-contract";
import { PageLayoutPicker } from "../page-layout";

import type { SettingsAddress } from "./settings-address";

/** Each document's panel heading, and the way to the rest of its settings. */
export const DOCUMENT_SETTINGS_WORDS: Record<
  DocumentKind,
  { heading: string; all: string }
> = {
  page: { heading: "Page settings", all: "All page settings…" },
  component: { heading: "Component settings", all: "All component settings…" },
  pattern: {
    heading: "Saved section settings",
    all: "All saved section settings…",
  },
  template: {
    heading: "Collection template settings",
    all: "All template settings…",
  },
};

/** The page fields the panel edits, by their names on every page's form. */
const TITLE_FIELD = "title";
const SLUG_FIELD = "slug";

export interface DocumentSettingsPanelProps {
  /** Which document is open: a page gets its address, layout and summary. */
  kind: DocumentKind;
  /** What the builder draws of the document itself: a component's fields. */
  own: ReactNode | null;
  /** The entry's form, which the header & footer picker writes through. */
  control: Control<FieldValues>;
  /** Opens Settings on its first tab, where the rest of the fields are. */
  onOpenSettings: () => void;
  /**
   * The page whose saved address the Copy button copies, or null for a
   * page never saved, which has none yet.
   */
  address: SettingsAddress | null;
  /**
   * Whether the SEO plugin edits search and sharing for this page's type.
   * Where it does, the search summary is its own to draw, so the builder
   * draws none of its own; where it does not, the panel shows what search
   * would take from the page.
   */
  seoEditsPage: boolean;
  /** How much the page reads, in its place after the search result. */
  pageData?: ReactNode;
}

export function DocumentSettingsPanel({
  kind,
  own,
  control,
  onOpenSettings,
  address,
  seoEditsPage,
  pageData = null,
}: DocumentSettingsPanelProps): JSX.Element {
  const words = DOCUMENT_SETTINGS_WORDS[kind];
  const headingId = useId();
  const title = useDocumentField(TITLE_FIELD);
  const slug = useDocumentField(SLUG_FIELD);
  const page = kind === "page";
  // Held as the title is: a past version on screen, someone else's claim, a
  // reader who may not edit. The picker writes the form directly, so it is
  // told, rather than trusted to ask.
  const held = title !== null && !title.writable;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4"
      data-document-settings={kind}
    >
      <h2
        id={headingId}
        className="text-[color:var(--nx-builder-text)] m-0 text-sm font-semibold"
      >
        {words.heading}
      </h2>
      {title === null ? null : <TitleRow field={title} />}
      {page && slug !== null && typeof slug.value === "string" ? (
        <AddressRow field={slug} address={address} />
      ) : null}
      {page ? <PageLayoutPicker control={control} disabled={held} /> : null}
      {page && !seoEditsPage ? (
        <SearchSummary
          title={typeof title?.value === "string" ? title.value : ""}
          address={address}
        />
      ) : null}
      {page ? pageData : null}
      {own}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-center"
        onClick={onOpenSettings}
      >
        {words.all}
      </Button>
    </section>
  );
}

/** The document's title: typed straight into the entry's own field. */
function TitleRow({ field }: { field: DocumentField }): JSX.Element {
  const id = useId();
  return (
    <div className="nx-inspector__field">
      <Label htmlFor={id}>Title</Label>
      <Input
        id={id}
        value={typeof field.value === "string" ? field.value : ""}
        disabled={!field.writable}
        onChange={event => field.set(event.target.value)}
        onKeyDown={keepEnterFromThePage}
      />
    </div>
  );
}

/**
 * The page's address: its slug, typed into the entry's own field, and the
 * address it is saved at, which Copy copies. A slug changed since the save
 * does not move it until the page is saved, and the line says so.
 */
function AddressRow({
  field,
  address,
}: {
  field: DocumentField;
  address: SettingsAddress | null;
}): JSX.Element {
  const id = useId();
  const noteId = `${id}-note`;
  const saved = useSavedAddress(address);
  return (
    <div className="nx-inspector__field">
      <Label htmlFor={id}>Address</Label>
      <div className="flex min-w-0 items-center gap-1">
        <Input
          id={id}
          className="min-w-0 flex-1 font-mono"
          value={typeof field.value === "string" ? field.value : ""}
          disabled={!field.writable}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          {...(address?.slugChanged === true
            ? { "aria-describedby": noteId }
            : {})}
          onChange={event => field.set(event.target.value)}
          onKeyDown={keepEnterFromThePage}
        />
        {saved === null ? null : <CopyAddress path={saved} />}
      </div>
      {address?.slugChanged === true ? (
        <p id={noteId} role="status" className="nx-inspector__note">
          The address changes when you save the page.
        </p>
      ) : null}
    </div>
  );
}

/** Copies the page's saved address, and says it did for a moment. */
function CopyAddress({ path }: { path: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (): void => {
    void navigator.clipboard?.writeText(path).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false)
    );
  };
  const Icon = copied ? Check : Copy;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label={copied ? "Address copied" : `Copy address ${path}`}
      title={copied ? "Copied" : "Copy address"}
      onClick={copy}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

/**
 * The address the page is saved at, read as Settings reads it, or null while
 * it is read, for a page never saved, and where the site gives it none.
 */
function useSavedAddress(address: SettingsAddress | null): string | null {
  const read = usePluginRoute<PageAddressResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path:
      address === null ? "" : pageAddressPath(address.page, address.locale),
    staleTime: 0,
    enabled: address !== null,
  });
  // Read again after each save: the saved address may have moved.
  const { refetch } = read;
  const revision = address?.savedRevision;
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    if (address !== null) void refetch();
  }, [revision, address, refetch]);
  return address === null ? null : (read.data?.path ?? null);
}

/**
 * What a search result would show where nothing sets it: the page's title
 * over its address. Only where the SEO plugin does not edit the page's type,
 * so no two summaries of one page can disagree.
 */
function SearchSummary({
  title,
  address,
}: {
  title: string;
  address: SettingsAddress | null;
}): JSX.Element {
  const saved = useSavedAddress(address);
  return (
    <section aria-label="Search result" className="nx-inspector__field">
      <p className="nx-inspector__field-name" aria-hidden="true">
        Search result
      </p>
      <div className="border-[color:var(--nx-builder-border)] min-w-0 rounded-md border px-2.5 py-2">
        {saved === null ? null : (
          <p className="text-[color:var(--nx-builder-text-muted)] m-0 truncate font-mono text-[11px]">
            {saved}
          </p>
        )}
        <p className="m-0 truncate text-[13px] font-medium text-info-text">
          {title.trim() === "" ? "Untitled page" : title}
        </p>
      </div>
      <p className="nx-inspector__note">
        Built from the page&apos;s title and address.
      </p>
    </section>
  );
}

/**
 * Enter in a field submits the form it sits in, and the editor is drawn
 * inside the page's form: Enter here only ends the typing.
 */
function keepEnterFromThePage(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  event.preventDefault();
}

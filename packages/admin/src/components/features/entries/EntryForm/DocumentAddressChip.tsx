"use client";

/**
 * The entry's address, under its title: the site's address and the entry's
 * path in one chip, with buttons to copy it, edit the slug in place, and open
 * the live page. The buttons are always drawn, never only on hover, so a
 * touch screen and a keyboard reach them as a pointer does.
 *
 * The slug is drawn as the form holds it, so an edit shows in the address
 * before it is saved. Where the site's address isn't set the chip shows the
 * path alone; where the entry's type has no public address, the slug alone.
 * "Open live page" is offered only for a published entry on a site with an
 * address, and opens the address that is live now.
 *
 * @module components/features/entries/EntryForm/DocumentAddressChip
 */

import type { FieldConfig } from "nextly/config";
import type { JSX, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { Copy, ExternalLink, Pencil } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import { addressChipText, type EntryAddress } from "./entry-details-read";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";

/** The slug the chip edits, and what decides whether it may be edited. */
export interface DocumentSlug {
  /** The slug field's config, which names the form field. */
  field: FieldConfig;
  /** Whether the slug is held read-only (a colleague's claim, a reader). */
  locked?: boolean;
  /**
   * Whether this entry's slug is already a public address, so editing it
   * retires a live URL and the chip says so.
   */
  hasPublicAddress?: boolean;
}

export interface DocumentAddressChipProps {
  /** The entry's slug; absent where the entry has none. */
  slug?: DocumentSlug | undefined;
  /**
   * Where the site serves the entry, from the server; null where its type
   * has no public address, undefined while that is not known yet.
   */
  address?: EntryAddress | null | undefined;
  /** Whether the entry is published, so its address is live. */
  published?: boolean;
}

export function DocumentAddressChip({
  slug,
  address,
  published = false,
}: DocumentAddressChipProps): JSX.Element | null {
  const form = useFormContext();
  const slugName =
    slug && "name" in slug.field ? (slug.field.name as string) : "slug";
  const edit = useSlugEdit(slugName);
  if (!form) return null;

  const readOnly = slug?.locked === true;
  const text = addressChipText({
    address,
    slug: slug ? (edit.liveValue ?? "") : undefined,
    published,
  });
  if (!text) return null;

  const editing = slug !== undefined && edit.editing && !readOnly;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <div
        data-testid="document-address"
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-0.5 font-mono text-xs text-muted-foreground"
      >
        <span
          className={cn(
            "min-w-0 whitespace-nowrap",
            // Cut short only while read; an open input is never clipped.
            !editing && "truncate"
          )}
          title={text.copied}
        >
          {text.before}
          {/* A claim arriving mid-edit closes the input: read-only wins. */}
          {editing ? (
            <SlugEditInput
              value={edit.draft}
              invalid={Boolean(edit.errorMsg)}
              onChange={edit.setDraft}
              onCommit={edit.commit}
              onCancel={edit.cancel}
            />
          ) : text.slug !== undefined ? (
            <span className="text-foreground">{text.slug || "(unset)"}</span>
          ) : null}
          {text.after}
        </span>
        {/* Nothing to copy until there is an address. */}
        {text.copied === "" ? null : <CopyAddressButton text={text.copied} />}
        {slug === undefined || readOnly || editing ? null : (
          <ChipButton label="Edit address" onClick={edit.startEdit}>
            <Pencil className="h-3 w-3" aria-hidden="true" />
          </ChipButton>
        )}
        {text.live === undefined ? null : (
          <a
            href={text.live}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open live page"
            title="Open live page"
            className={CHIP_BUTTON}
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>
      {slug === undefined ? null : (
        <SlugNote
          errorMsg={edit.errorMsg}
          readOnly={readOnly}
          slugName={slugName}
          warnOnChange={slug.hasPublicAddress === true}
        />
      )}
    </div>
  );
}

/**
 * The chip's round buttons: a fixed size that grows under a coarse pointer,
 * so a finger finds them, and always drawn.
 */
const CHIP_BUTTON = cn(
  "inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted font-sans text-muted-foreground transition-colors",
  "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "pointer-coarse:h-8 pointer-coarse:w-8"
);

function ChipButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={CHIP_BUTTON}
    >
      {children}
    </button>
  );
}

/** Copies the address and says so; where the browser refuses, shows it to copy by hand. */
function CopyAddressButton({ text }: { text: string }) {
  const refused = () =>
    toast.error("Couldn't copy the address", { description: text });
  return (
    <ChipButton
      label="Copy address"
      onClick={() => {
        if (!navigator.clipboard?.writeText) {
          refused();
          return;
        }
        navigator.clipboard
          .writeText(text)
          .then(() => toast.success("Address copied"), refused);
      }}
    >
      <Copy className="h-3 w-3" aria-hidden="true" />
    </ChipButton>
  );
}

/**
 * The slug's edit state: the form's live value and its error, whether the
 * input is open, the draft in it, and the three moves (open, save, put back).
 * Opening and putting back both start from the form's value, so an edit
 * abandoned leaves nothing behind.
 */
function useSlugEdit(slugName: string) {
  const form = useFormContext();
  const liveValue = form?.watch(slugName) as string | undefined;
  const errorMsg = (
    form?.formState.errors[slugName] as { message?: string } | undefined
  )?.message;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(liveValue ?? "");
  return {
    liveValue,
    errorMsg,
    editing,
    draft,
    setDraft,
    startEdit: () => {
      setDraft(liveValue ?? "");
      setEditing(true);
    },
    commit: () => {
      form?.setValue(slugName, draft, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setEditing(false);
    },
    cancel: () => {
      setDraft(liveValue ?? "");
      setEditing(false);
    },
  };
}

/**
 * The slug's input, in its place in the address and focused as it opens:
 * Enter saves, Esc puts the value back, and leaving it saves, as Enter does.
 */
function SlugEditInput({
  value,
  invalid,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e => {
        const move = SLUG_KEYS[e.key];
        if (move === undefined) return;
        e.preventDefault();
        if (move === "commit") onCommit();
        else onCancel();
      }}
      // As wide as what is typed, within the chip.
      size={Math.max(value.length, 8)}
      className="h-5 max-w-full rounded border border-input bg-background px-1 font-mono text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
      aria-label="Address"
      aria-invalid={invalid}
    />
  );
}

/** The keys the slug's input answers, and what each does. */
const SLUG_KEYS: Record<string, "commit" | "cancel" | undefined> = {
  Enter: "commit",
  Escape: "cancel",
};

/**
 * What follows the chip: the slug's error when it has one; otherwise, where it
 * can be edited, the notice that changing a live address retires a URL.
 */
function SlugNote({
  errorMsg,
  readOnly,
  slugName,
  warnOnChange,
}: {
  errorMsg: string | undefined;
  readOnly: boolean;
  slugName: string;
  warnOnChange: boolean;
}) {
  if (errorMsg) {
    return (
      <span className="shrink-0 text-xs text-danger-text" role="alert">
        {errorMsg}
      </span>
    );
  }
  if (readOnly) return null;
  return (
    <PublicUrlChangeNotice
      slugName={slugName}
      active={warnOnChange}
      className="shrink-0"
    />
  );
}

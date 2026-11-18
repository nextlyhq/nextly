"use client";

/**
 * Page settings' General tab: the page's title and its address, drawn by the
 * entry form's own renderer (so their rules and validation are the form's),
 * the address with the entry header's copy and in-place edit; then the page's
 * header & footer, and its search and sharing: what a plugin that edits SEO
 * says there (`settings-search`), or, where none does, the builder's own
 * read-only preview of a shared link, built from the page itself.
 *
 * A document that is not a page (a component, a template) keeps its own
 * settings here as they were: its fields as the form draws them, then its
 * search and sharing the same way.
 *
 * @module admin/editor/settings-general
 */
import {
  useDocumentField,
  useEntryFieldsPanel,
} from "@nextlyhq/plugin-sdk/admin";
import type { JSX, ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";

import { PageLayoutPicker } from "../page-layout";

import { useSavedAddress, type SettingsAddress } from "./settings-address";
import type { SettingsPlace } from "./settings-place";
import { SearchPlace } from "./settings-search";
import type { SharePreview } from "./share-preview";

export interface PageGeneralProps {
  /** The form path of the field the builder edits, which is never drawn. */
  fieldName: string;
  /** The page's header & footer menu, or null for a page without one. */
  headerFooter: ReactNode | null;
  share: SharePreview;
  /**
   * The Settings place, where a plugin that edits SEO draws the page's
   * search and sharing; null for a document that offers none.
   */
  place: SettingsPlace | null;
  /** The saved page whose address may sit beneath another page's. */
  address: SettingsAddress | null;
  open: boolean;
}

/** General on a page: Title, Address, Header & footer, then sharing. */
export function PageGeneral({
  fieldName,
  headerFooter,
  share,
  place,
  address,
  open,
}: PageGeneralProps): JSX.Element {
  const identity = useEntryFieldsPanel(fieldName, {
    presentation: "dialog",
    group: "page",
  });
  return (
    <div className="space-y-6">
      {identity === null && address === null ? null : (
        <section className="space-y-2">
          {identity}
          {address === null ? null : (
            <NestedAddressHint address={address} open={open} />
          )}
        </section>
      )}
      {headerFooter}
      <SearchPlace
        place={place}
        at="general"
        plain={<ShareSection share={share} />}
      />
    </div>
  );
}

/**
 * The page's "Header & footer" menu, the one the right panel and the entry
 * page draw, held as the title is: a past version on screen, a colleague's
 * claim, a reader who may not edit. The menu writes the form directly, so it
 * is told rather than trusted to ask.
 */
export function HeaderFooterMenu({
  control,
}: {
  control: Control<FieldValues>;
}): JSX.Element | null {
  const held = useDocumentField("title")?.writable === false;
  return <PageLayoutPicker control={control} disabled={held} />;
}

/**
 * General on a document that is not a page: its fields as the form draws
 * them, then the share preview, as its settings have always been.
 */
export function DocumentGeneral({
  fieldName,
  share,
  place,
}: Pick<PageGeneralProps, "fieldName" | "share" | "place">): JSX.Element {
  const fields = useEntryFieldsPanel(fieldName, { presentation: "dialog" });
  return (
    <div className="space-y-6">
      {fields === null ? null : (
        <section className="space-y-2">{fields}</section>
      )}
      <SearchPlace
        place={place}
        at="general"
        plain={<ShareSection share={share} />}
      />
    </div>
  );
}

/**
 * The hint that a page's address can sit beneath another page's. Only the
 * plugin's own Pages may, and only theirs have an address the plugin's own
 * read answers, so it is shown where that read finds one: never while it is
 * read, or for a page of another collection.
 */
function NestedAddressHint({
  address,
  open,
}: {
  address: SettingsAddress;
  open: boolean;
}): JSX.Element | null {
  const read = useSavedAddress(address, open);
  if (read.data?.path === null || read.data === undefined) return null;
  return (
    <p className="text-xs text-muted-foreground" data-nested-address-hint="">
      To put this page beneath another, use / in its address, as in{" "}
      <span className="font-mono">docs/getting-started</span>.
    </p>
  );
}

/**
 * How a shared link to the page would look, and where it comes from: drawn
 * only where no plugin edits SEO, so it never stands beside another preview.
 */
function ShareSection({ share }: { share: SharePreview }): JSX.Element {
  return (
    <section aria-labelledby="settings-share-title" className="space-y-2">
      <h3 id="settings-share-title" className="text-sm font-semibold">
        Search and sharing
      </h3>
      <SharePreviewCard share={share} />
      <p className="text-xs text-muted-foreground">
        {"Approximate: your site's metadata may differ."}
      </p>
      <p className="text-sm text-muted-foreground">
        {
          "Built from this page's title, first heading and first image. The SEO plugin lets you set them yourself."
        }
      </p>
    </section>
  );
}

/** How a shared link would look: image, title and description. */
function SharePreviewCard({ share }: { share: SharePreview }): JSX.Element {
  return (
    <figure
      aria-label="Share preview"
      className="max-w-[420px] overflow-hidden rounded-md border border-border"
    >
      {share.image === undefined ? null : share.image.kind === "url" ? (
        <img
          src={share.image.url}
          alt=""
          className="h-40 w-full border-b border-border object-cover"
        />
      ) : (
        <div className="flex h-40 items-center justify-center border-b border-border bg-muted text-xs text-muted-foreground">
          {share.image.kind === "media"
            ? "Image from the media library"
            : "Image from another site"}
        </div>
      )}
      <figcaption className="grid gap-0.5 px-3 py-2.5">
        <span className="text-sm font-semibold">{share.title}</span>
        {share.description === undefined ? null : (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {share.description}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

"use client";

/**
 * The editor's Settings: what the editor reads of the page's own fields, the
 * share preview built from the page as it is now, and the dialog the shell's
 * rail opens.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-settings
 */
import type { DocumentKind } from "@nextlyhq/blocks-engine";
import {
  prepareDocumentForRead,
  registeredBlocks,
} from "@nextlyhq/blocks-react";
import type { BuilderShell } from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import {
  useFormState,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import type { EditorView } from "./editor-view";
import { ManageSetsContext } from "./manage-sets";
import {
  settingsAddressOf,
  useSavedRevision,
  type SettingsAddress,
} from "./settings-address";
import { SettingsDialog } from "./settings-dialog";
import { HeaderFooterMenu } from "./settings-general";
import type { SettingsPlace } from "./settings-place";
import {
  sharePreview,
  type SharePreview,
  type ShareSeoFields,
} from "./share-preview";
import { RemountOnStyleReplay } from "./site-style-history";
import { siteStyleStatus } from "./site-style-studios";

/** What the editor reads of the page's own fields as the author has them now. */
export interface PageFacts {
  /** The form's `title` while it is text, for the top bar and the preview. */
  title: string | undefined;
  /** The SEO plugin's fields, where the document has them. */
  seo: ShareSeoFields | undefined;
  /**
   * The page whose saved address Settings reads, and whether its slug has
   * changed since the save, or null for a document never saved.
   */
  address: Omit<SettingsAddress, "locale"> | null;
}

/** The field a page's address is made from, where the collection has one. */
const SLUG_FIELD = "slug";

export function usePageFacts<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>
): PageFacts {
  const [title, seo, slug]: unknown[] = useWatch({
    control,
    name: ["title", "seo", SLUG_FIELD] as Path<TFieldValues>[],
  });
  // The form's defaults are what the last load or save stored, so the slug
  // there is the saved one, the slug the server's address is read for.
  const { defaultValues } = useFormState({
    control,
    name: SLUG_FIELD as Path<TFieldValues>,
  });
  const saved: unknown = (
    defaultValues as Record<string, unknown> | undefined
  )?.[SLUG_FIELD];
  return {
    title: typeof title === "string" ? title : undefined,
    seo: seo !== null && typeof seo === "object" ? seo : undefined,
    address: settingsAddressOf(
      useDocumentIdentity(),
      slug,
      saved,
      useSavedRevision(defaultValues)
    ),
  };
}

/**
 * How a shared link to the page would look, from the page as the published
 * route reads it: prepared with the canvas's own inputs (the same resolver,
 * limits and component definitions), so a component's heading speaks for the
 * page as it does once published.
 */
function pagePreview(view: EditorView, page: PageFacts): SharePreview {
  const { editor, canvasRender } = view;
  const resolver = registeredBlocks();
  const prepared = prepareDocumentForRead(editor.document, {
    resolver,
    styleContext: canvasRender.styleContext,
    definitions: canvasRender.definitions,
    ...(canvasRender.limits === undefined
      ? {}
      : { limits: canvasRender.limits }),
  });
  return sharePreview({
    seo: page.seo,
    document: prepared,
    pageTitle: page.title ?? "",
    definitions: type => resolver.get(type),
  });
}

/**
 * The page whose saved address Settings and the right panel read, in the
 * language being edited, as a localized slug is; null for a page never saved.
 */
export function pageAddressOf(
  view: Pick<EditorView, "locale">,
  page: PageFacts
): SettingsAddress | null {
  if (page.address === null) return null;
  return {
    ...page.address,
    ...(view.locale === undefined ? {} : { locale: view.locale }),
  };
}

/** What Settings is drawn for besides the editor's view and the page. */
export interface SettingsFor {
  /** Which document is open: a page gets General, Fields and its address. */
  kind: DocumentKind;
  /** The form path of the field the builder edits. */
  fieldName: string;
  /** The entry's form, which the header & footer menu writes through. */
  control: Control<FieldValues>;
  /** Opens the document's form, as the ⋯ menu's "Open as form" does. */
  openAsForm?: (() => void) | undefined;
}

/**
 * Page settings, as the shell's rail opens it: the entry's own fields and a
 * share preview built from the page as it is now, and the site's
 * breakpoints, read from the same answer the canvas and the device buttons
 * are.
 */
export function editorSettings(
  view: EditorView,
  page: PageFacts,
  place: SettingsPlace | null,
  of: SettingsFor
): NonNullable<React.ComponentProps<typeof BuilderShell>["renderSettings"]> {
  const {
    pageLayout,
    canvasRender,
    saveBreakpoints,
    refreshSiteStyle,
    siteStylePending,
    siteStyleError,
  } = view;
  // Remounted when a style change is undone or redone, as every surface
  // showing the site's style is, so its breakpoints show the set replayed.
  // Drawn afresh for each request to open it (the right panel's "All page
  // settings…", a Pages row's "Settings"), so it opens on the page's own
  // first tab, whichever tab it was left on.
  return dialog => (
    <RemountOnStyleReplay>
      {/* The page's header & footer menu's "Manage headers & footers", and
          the site default line: the Pages panel opens on its sets. */}
      <ManageSetsContext.Provider
        value={() => {
          // Settings closes itself first, as it may be left (it asks over
          // an unsaved draft); then the panel opens on its sets.
          view.requestPanel("pages");
          view.pages.revealSets();
        }}
      >
        <SettingsDialog
          key={view.pages.settingsRequest?.count ?? 0}
          {...dialog}
          kind={of.kind}
          pageTitle={page.title}
          fieldName={of.fieldName}
          // Other plugins' tabs, in the same row as the page's own.
          place={place}
          // The page's header & footer, where its form has one.
          headerFooter={
            pageLayout === null ? null : (
              <HeaderFooterMenu control={of.control} />
            )
          }
          openAsForm={of.openAsForm}
          // Built only while the dialog is drawn, from the page on screen.
          share={
            // Prepared only while Settings is open: the shell asks for the
            // dialog on every pass, open or not.
            dialog.open ? pagePreview(view, page) : { title: page.title ?? "" }
          }
          // The SEO plugin's group, where the page has one: its fields are then
          // among the page's own, and the preview is not all there is.
          seoFields={page.seo !== undefined}
          address={pageAddressOf(view, page)}
          breakpoints={{
            value: canvasRender.styleContext.breakpoints,
            onSave: saveBreakpoints,
            status: siteStyleStatus(siteStylePending, siteStyleError),
            refresh: refreshSiteStyle,
          }}
        />
      </ManageSetsContext.Provider>
    </RemountOnStyleReplay>
  );
}

"use client";

/**
 * The editor's Settings: what the editor reads of the page's own fields, the
 * share preview built from the page as it is now, and the dialog the shell's
 * rail opens.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-settings
 */
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
import {
  settingsAddressOf,
  useSavedRevision,
  type SettingsAddress,
} from "./settings-address";
import { SettingsDialog } from "./settings-dialog";
import type { SettingsPlace } from "./settings-place";
import {
  sharePreview,
  type SharePreview,
  type ShareSeoFields,
} from "./share-preview";
import { RemountOnStyleReplay } from "./site-style-history";
import { siteStyleStatus } from "./site-style-studios";

/** What the editor reads of the page's own fields as the author has them now. */
interface PageFacts {
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
 * Settings, as the shell's rail opens it: the entry's own fields and a share
 * preview built from the page as it is now, and the site's breakpoints, read
 * from the same answer the canvas and the device buttons are.
 */
export function editorSettings(
  view: EditorView,
  page: PageFacts,
  place: SettingsPlace | null
): NonNullable<React.ComponentProps<typeof BuilderShell>["renderSettings"]> {
  const {
    entryFields,
    pageLayout,
    canvasRender,
    saveBreakpoints,
    refreshSiteStyle,
    siteStylePending,
    siteStyleError,
  } = view;
  // Remounted when a style change is undone or redone, as every surface
  // showing the site's style is, so its breakpoints show the set replayed.
  return dialog => (
    <RemountOnStyleReplay>
      <SettingsDialog
        {...dialog}
        pageFields={entryFields}
        // Other plugins' tabs beside the page's own settings.
        place={place}
        // The page's Layout, in its own section after the page's fields.
        pageLayout={pageLayout}
        // Built only while the dialog is drawn, from the page on screen.
        share={
          // Prepared only while Settings is open: the shell asks for the
          // dialog on every pass, open or not.
          dialog.open ? pagePreview(view, page) : { title: page.title ?? "" }
        }
        // The SEO plugin's group, where the page has one: its fields are then
        // among the page's own, and the preview is not all there is.
        seoFields={page.seo !== undefined}
        // Read in the language being edited, as a localized slug is.
        address={
          page.address === null
            ? null
            : {
                ...page.address,
                ...(view.locale === undefined ? {} : { locale: view.locale }),
              }
        }
        breakpoints={{
          value: canvasRender.styleContext.breakpoints,
          onSave: saveBreakpoints,
          status: siteStyleStatus(siteStylePending, siteStyleError),
          refresh: refreshSiteStyle,
        }}
      />
    </RemountOnStyleReplay>
  );
}

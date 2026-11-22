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
import {
  useLatestCallback,
  useLatestOptionalCallback,
  type BuilderShell,
} from "@nextlyhq/builder/shell";
import { useDocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useRef } from "react";
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
    address: useKeptAddress(
      settingsAddressOf(
        useDocumentIdentity(),
        slug,
        saved,
        useSavedRevision(defaultValues)
      )
    ),
  };
}

/**
 * The address as one value while what it says is the same: it is worked out
 * afresh on every render, and Settings, which shows it, is drawn again only
 * for a value that changed.
 */
function useKeptAddress(next: PageFacts["address"]): PageFacts["address"] {
  const kept = useRef(next);
  if (!sameAddress(kept.current, next)) kept.current = next;
  return kept.current;
}

/**
 * Whether two addresses say the same thing: every field the same, the page by
 * its collection and id. Every field, rather than a list of them, so a field
 * the address gains is compared too.
 */
function sameAddress(
  a: PageFacts["address"],
  b: PageFacts["address"]
): boolean {
  if (a === null || b === null) return a === b;
  const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const field of fields as Set<keyof typeof a>) {
    if (field === "page") {
      if (a.page.collection !== b.page.collection || a.page.id !== b.page.id)
        return false;
    } else if (a[field] !== b[field]) return false;
  }
  return true;
}

/**
 * How a shared link to the page would look, from the page as the published
 * route reads it: prepared with the canvas's own inputs (the same resolver,
 * limits and component definitions), so a component's heading speaks for the
 * page as it does once published.
 */
function pagePreview(
  document: EditorView["editor"]["document"],
  canvasRender: Pick<
    EditorView["canvasRender"],
    "styleContext" | "definitions" | "limits"
  >,
  page: Pick<PageFacts, "seo" | "title">
): SharePreview {
  const resolver = registeredBlocks();
  const prepared = prepareDocumentForRead(document, {
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
  page: Pick<PageFacts, "address">
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

/** What the shell draws Page settings with. */
type RenderSettings = NonNullable<
  React.ComponentProps<typeof BuilderShell>["renderSettings"]
>;

/**
 * Page settings, as the shell's rail opens it: the entry's own fields and a
 * share preview built from the page as it is now, and the site's
 * breakpoints, read from the same answer the canvas and the device buttons
 * are.
 *
 * One function while what Settings shows is the same. Nothing in it shows the
 * selected block, and the shell draws it again only for a new function (or as
 * it opens or closes), so a selection draws none of it. It is built from the
 * values it shows, the page's document among them (the share preview is
 * prepared from it while Settings is open), so an edit, an undo or a rename
 * hands the shell a new one; its handlers are read when pressed.
 */
export function useEditorSettings(
  view: EditorView,
  page: PageFacts,
  place: SettingsPlace | null,
  of: SettingsFor
): RenderSettings {
  const { canvasRender, siteStylePending, siteStyleError, locale, pages } =
    view;
  const { document } = view.editor;
  const { styleContext, definitions, limits } = canvasRender;
  const { breakpoints } = styleContext;
  const hasPageLayout = view.pageLayout !== null;
  const settingsKey = pages.settingsRequest?.count ?? 0;
  const { title, seo, address: savedAddress } = page;
  const { kind, fieldName, control } = of;
  // Read when pressed, so the function below need not change with them.
  const saveBreakpoints = useLatestCallback(view.saveBreakpoints);
  const refreshSiteStyle = useLatestCallback(view.refreshSiteStyle);
  const openAsForm = useLatestOptionalCallback(of.openAsForm);
  // The page's header & footer menu's "Manage headers & footers", and the
  // site default line: Settings closes itself first, as it may be left (it
  // asks over an unsaved draft); then the Pages panel opens on its sets.
  const manageSets = useLatestCallback(() => {
    view.requestPanel("pages");
    view.pages.revealSets();
  });
  const address = useMemo(
    () => pageAddressOf({ locale }, { address: savedAddress }),
    [locale, savedAddress]
  );
  return useMemo(
    (): RenderSettings =>
      // Remounted when a style change is undone or redone, as every surface
      // showing the site's style is, so its breakpoints show the set
      // replayed. Drawn afresh for each request to open it (the right
      // panel's "All page settings…", a Pages row's "Settings"), so it opens
      // on the page's own first tab, whichever tab it was left on.
      dialog => (
        <RemountOnStyleReplay>
          <ManageSetsContext.Provider value={manageSets}>
            <SettingsDialog
              key={settingsKey}
              {...dialog}
              kind={kind}
              pageTitle={title}
              fieldName={fieldName}
              // Other plugins' tabs, in the same row as the page's own.
              place={place}
              // The page's header & footer, where its form has one.
              headerFooter={
                hasPageLayout ? <HeaderFooterMenu control={control} /> : null
              }
              openAsForm={openAsForm}
              // Built only while the dialog is drawn, from the page on screen.
              share={
                // Prepared only while Settings is open: the shell asks for
                // the dialog again each time it opens or closes.
                dialog.open
                  ? pagePreview(
                      document,
                      { styleContext, definitions, limits },
                      { seo, title }
                    )
                  : { title: title ?? "" }
              }
              address={address}
              breakpoints={{
                value: breakpoints,
                onSave: saveBreakpoints,
                status: siteStyleStatus(siteStylePending, siteStyleError),
                refresh: refreshSiteStyle,
              }}
            />
          </ManageSetsContext.Provider>
        </RemountOnStyleReplay>
      ),
    [
      manageSets,
      settingsKey,
      kind,
      title,
      fieldName,
      place,
      hasPageLayout,
      control,
      openAsForm,
      document,
      styleContext,
      definitions,
      limits,
      seo,
      address,
      breakpoints,
      saveBreakpoints,
      siteStylePending,
      siteStyleError,
      refreshSiteStyle,
    ]
  );
}

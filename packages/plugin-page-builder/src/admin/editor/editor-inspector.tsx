"use client";

/**
 * The editor's inspector, given the same readings the canvas draws with.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-inspector
 */
import {
  InspectorPanel,
  type ComponentFieldsHost,
  type ComponentVariantsHost,
  type SharedStylesHost,
  type VariantPreviewState,
} from "@nextlyhq/builder/shell";
import type { Control, FieldValues } from "react-hook-form";

import { contributedInspector } from "../contributed-blocks";

import { DocumentSettingsPanel } from "./document-settings-panel";
import { servicesFor } from "./editor-services";
import { pageAddressOf, type PageFacts } from "./editor-settings";
import type { CardVerbs, EditorView } from "./editor-view";
import { PageReadMeter, type PageDataCount } from "./page-read-meter";
import { SelectedRegionCard } from "./region-card";
import {
  offerableFaces,
  offerableTokens,
  siteStyleStatus,
} from "./site-style-studios";

/** The entry's form and what the editor reads of it, for the panel's rows. */
interface EntryForm<TFieldValues extends FieldValues> {
  control: Control<TFieldValues>;
  page: PageFacts;
  /** The page's data count, which Page settings shows at every level. */
  pageData: PageDataCount | null;
}

/** The inspector, given the same readings the canvas draws with. */
export function editorInspector<TFieldValues extends FieldValues>(
  view: EditorView,
  verbs: CardVerbs,
  sharedStyles: SharedStylesHost,
  form: EntryForm<TFieldValues>
): React.JSX.Element {
  const {
    editor,
    canvasElement,
    componentLibrary,
    styleStateBinding,
    classes,
    stylePolicy,
    styleCascade,
    canvasRender,
    chooseDevice,
    editedBreakpoint,
    liveBreakpoints,
    canvasSiteStyle,
    configSiteStyle,
    siteStylePending,
    siteStyleError,
    requestPanel,
    componentFacts,
    componentVariants,
  } = view;
  return (
    <InspectorPanel
      editor={editor}
      // The SAME ref the canvas publishes its root through, so the style
      // tab reads the element a node is actually drawn as rather than
      // inferring one from the document. Two refs would let the panel
      // read a canvas that is not the one on screen.
      canvasRoot={canvasElement}
      // The SAME read the canvas resolves against, for the reason the
      // ref is the same ref: a selected instance's rows are read from the
      // very document the page is drawn from, and titled from the row
      // the same read returned.
      componentLibrary={componentLibrary}
      // A contributed block's own inspector, loaded by the app's generated
      // component map; a block whose inspector did not load keeps its
      // generated controls.
      inspectors={contributedInspector}
      // The verbs provider's own verbs and verdicts for Duplicate and Delete,
      // handed out of it because the inspector is drawn beside the canvas
      // rather than under it.
      verbs={verbs}
      contentServices={servicesFor(
        view.passages,
        view.locale,
        view.readMedia,
        view.searchMedia,
        view.entryCollection,
        view.userId,
        {
          entry: view.bindingEntry,
          page: view.editedDocument,
          canvas: view.canvasEntry,
        },
        // The language the canvas's binding pass is given, its context's, as
        // the published page's is its route's.
        canvasRender.context?.locale
      )}
      // A placement's exposed passage the canvas is editing in place: its
      // field in the placement panel is held meanwhile, as one editor serves
      // both.
      canvasPassage={view.inline.editingRich?.exposure ?? null}
      styleState={styleStateBinding}
      classLibrary={classes.library}
      classLibraryAbsence={classes.absence}
      // The author's right, the style write and the reach reads, so a
      // shared style the block wears can become the Style tab's target.
      sharedStyles={sharedStyles}
      {...(view.lookEditing.look === null
        ? {}
        : {
            lookEditing: {
              look: view.lookEditing.look,
              onExit: view.lookEditing.exit,
            },
          })}
      policy={stylePolicy}
      cascade={styleCascade}
      breakpoints={canvasRender.styleContext.breakpoints}
      // The set above is the config's defaults until the stored one is read,
      // so a per-device hide waits for it.
      breakpointsStatus={siteStyleStatus(siteStylePending, siteStyleError)}
      // Which tier the Style tab writes to, and which tiers are live: the
      // canvas's answer rather than the panel's, as the frame's width is
      // what the page's media queries answer for.
      /*
       * Going to a tier is CHOOSING ITS DEVICE, never setting a second
       * piece of state saying which tier is being edited, so the device the
       * frame shows and the tier edits go to cannot disagree.
       */
      // Already a TIER, so it is stored directly rather than converted
      // to a width and back.
      onJumpToBreakpoint={chooseDevice}
      breakpoint={editedBreakpoint}
      liveBreakpoints={liveBreakpoints}
      tokens={offerableTokens(
        canvasSiteStyle,
        siteStylePending,
        siteStyleError
      )}
      // The Font control lists only what the site can draw: the faces the
      // canvas loads, of which those from the site's code cannot be removed,
      // and a way to Design's fonts to add one.
      fonts={{
        faces: offerableFaces(
          canvasSiteStyle,
          siteStylePending,
          siteStyleError
        ),
        fromCode: configSiteStyle.fonts ?? [],
        onManageFonts: () => requestPanel("design", "type"),
      }}
      // "Edit block styles" under the Block style tiles: Design's Styles tab,
      // at the block's type.
      onEditBlockStyles={view.openBlockStyles}
      // In a component's own view: the ids its live definition holds, which a
      // new field must never reuse, how far a removal reaches, and its name
      // for the card heading the view, which is the open document's title.
      componentFields={namedFacts(componentFacts, view.pageTitle)}
      // And how many placements chose a variant, for its delete dialog, and
      // the open variant, which the canvas previews.
      componentVariants={previewingHost(componentVariants, view.preview)}
      // A header or footer selected on the canvas: what it is, where it
      // comes from and how to change it, in place of the page's settings.
      {...regionCardOf(view)}
      // With nothing selected: the open document's own settings, editing
      // the entry's form as Settings does, saved with the page's draft.
      documentSettings={own => (
        <DocumentSettingsPanel
          kind={view.initialDocument.kind}
          own={own}
          control={form.control as unknown as Control<FieldValues>}
          onOpenSettings={view.pages.openSettings}
          address={pageAddressOf(view, form.page)}
          // The one signal Settings reads too: the SEO plugin's group on
          // the page's form.
          seoEditsPage={form.page.seo !== undefined}
          // The page's data at every level, so it can always be found.
          pageData={<PageReadMeter count={form.pageData} place="settings" />}
        />
      )}
    />
  );
}

/**
 * The selected header or footer's card, drawn afresh for each region chosen
 * so its pages are counted as they stand; nothing while none is selected.
 */
function regionCardOf(view: EditorView): { regionCard?: React.ReactNode } {
  const facts = view.selectedRegion.card;
  if (facts === undefined) return {};
  return {
    regionCard: (
      <SelectedRegionCard
        key={`${facts.area}:${facts.componentId}`}
        facts={facts}
        onEditComponent={view.componentView.onEditComponent}
        onOpenSettings={view.pages.openSettings}
      />
    ),
  };
}

/** The variants host, holding the open variant for the canvas to preview. */
function previewingHost(
  host: ComponentVariantsHost | undefined,
  preview: VariantPreviewState
): ComponentVariantsHost {
  return { ...host, preview: preview.binding };
}

/** The component facts with the component's name, or nothing for a page. */
function namedFacts(
  facts: ComponentFieldsHost | undefined,
  title: string | undefined
): ComponentFieldsHost | undefined {
  if (facts === undefined || title === undefined || title === "") return facts;
  return { ...facts, name: title };
}

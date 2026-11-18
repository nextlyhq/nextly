/**
 * What the editor's shell is filled from: the mount, the site's style, the
 * canvas's inputs and the panels, with the readings the editor's body adds.
 * One type every slot filler takes, so each reads the same view.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-view
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type {
  AppliedConditions,
  InspectorPanel,
} from "@nextlyhq/builder/shell";
import type { DocumentIdentity } from "@nextlyhq/plugin-sdk/admin";
import type { ComponentProps } from "react";

import type { useComponentSettingHold } from "./component-setting-hold";
import type { EditorPanels } from "./editor-panels";
import type {
  ReadMediaSummary,
  SearchMediaSummaries,
} from "./media-summary-reader";
import type { Reveal } from "./reveal-hidden";
import type { ComponentView } from "./use-component-view";
import type { EditorMount } from "./use-editor-mount";
import type {
  CanvasInputs,
  SiteStyleInputs,
  useBoundCanvasRender,
} from "./use-render-inputs";

/** Everything the shell's slots are filled from. */
export type EditorView = EditorMount &
  SiteStyleInputs &
  CanvasInputs &
  EditorPanels & {
    /**
     * The bound props on the page a visitor will not see filled, by node id,
     * for the canvas's badges and the inspector's note.
     */
    visitorUnreadable: ReturnType<
      typeof useBoundCanvasRender
    >["visitorUnreadable"];
    documentDirty: boolean;
    pageTitle: string | undefined;
    /** "Edit component", and the banner over a component's own view. */
    componentView: ComponentView;
    /** Plan a setting of a placed component, held for the page's Save. */
    makeComponentSetting: ReturnType<
      typeof useComponentSettingHold
    >["makeComponentSetting"];
    /** The block verbs shared for the surfaces drawn outside the provider. */
    layerVerbs: CardVerbs;
    /** What the canvas draws: the document, with selected hidden blocks shown. */
    reveal: Reveal;
    /** The conditioned blocks the page can't check, which the canvas badges red. */
    conditionsUnchecked: ReadonlySet<string>;
    /**
     * The page with its conditions applied for the previewed entry, while
     * the author's switch is on; the canvas then draws a hidden block as a
     * marker and badges a shown one so.
     */
    conditionsApplied: AppliedConditions | undefined;
    /**
     * The page as the canvas draws it, a template's previewed entry's own
     * blocks composed in: the one composition the canvas draws.
     */
    composedDocument: BlockDocument;
    /** What a block shown for the previewed entry is badged with. */
    conditionsShownLabel: string;
    /** A stored media id's name, picture and alt text, for the image fields. */
    readMedia: ReadMediaSummary;
    /** The library's images by name, for an image binding's Fallback picker. */
    searchMedia: SearchMediaSummaries;
    /** The variant open in a component's view, which the canvas previews. */
    preview: ComponentView["preview"];
    /**
     * The collection the document is an entry of, so a list on it can show
     * the entry's related entries; `null` on a Single, which has none.
     */
    entryCollection: string | null | undefined;
    /**
     * The entry the document's bindings read: its own, or the entry a
     * template is previewed with. The binding picker lists its fields.
     */
    bindingEntry: DocumentIdentity | null;
    /** The document being edited, which an unbind is planned against. */
    editedDocument: DocumentIdentity | null;
    /**
     * The entry the canvas is drawn as, a component's view included, which
     * the inspector's read of the site's time zone is asked for.
     */
    canvasEntry: DocumentIdentity | null;
  };

/** The block verbs the inspector's card offers, as the verbs provider shares them. */
export type CardVerbs = ComponentProps<typeof InspectorPanel>["verbs"];
